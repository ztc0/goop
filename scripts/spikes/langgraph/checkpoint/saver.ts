// T14 spike: a LangGraph checkpoint saver over the encrypted sqlite3mc store from T10 (ADR 0001).
// Checkpoints hold the whole conversation, so they never go to bun:sqlite. Spike code, not product
// code: no migration of pre-v4 checkpoints and no getDeltaChannelHistory override.
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointPendingWrite,
  type CheckpointTuple,
  compareWritesSortKeys,
  type PendingWrite,
  type SerializerProtocol,
  WRITES_IDX_MAP,
  writesSortKey,
} from "@langchain/langgraph-checkpoint";
import type { Connection, Row, Sqlite3mc } from "../../encrypted-sqlite/sqlite3mc";

/** Spike-only passphrase. Never a real key. */
export const INSECURE_SPIKE_KEY = "insecure-spike-key-do-not-use";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS checkpoints (
  thread_id TEXT NOT NULL, checkpoint_ns TEXT NOT NULL, checkpoint_id TEXT NOT NULL,
  parent_id TEXT NOT NULL, type TEXT NOT NULL, checkpoint BLOB, metadata BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id));
CREATE TABLE IF NOT EXISTS writes (
  thread_id TEXT NOT NULL, checkpoint_ns TEXT NOT NULL, checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL, idx INTEGER NOT NULL, task_path TEXT NOT NULL, channel TEXT NOT NULL,
  type TEXT NOT NULL, value BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx));`;

// The wrapper binds no NULL, so a missing parent is stored as "".
const COLUMNS = "thread_id, checkpoint_ns, checkpoint_id, parent_id, type, checkpoint, metadata";

function ids(config: RunnableConfig) {
  const configurable = config.configurable ?? {};
  return {
    threadId: configurable.thread_id as string | undefined,
    ns: (configurable.checkpoint_ns as string | undefined) ?? "",
    checkpointId: configurable.checkpoint_id as string | undefined,
  };
}

function configOf(threadId: string, ns: string, checkpointId: string): RunnableConfig {
  return { configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: checkpointId } };
}

// An empty blob comes back as NULL through bind_blob; serde output is never empty, but be safe.
const bytes = (cell: Row[number]) => (cell instanceof Uint8Array ? cell : new Uint8Array());

export class EncryptedSqliteSaver extends BaseCheckpointSaver {
  constructor(
    private readonly db: Connection,
    serde?: SerializerProtocol,
  ) {
    super(serde);
    this.db.exec(SCHEMA);
  }

  /** Opens (or creates) the database, sets the key and proves it with a read of sqlite_master. */
  static open(mc: Sqlite3mc, path: string, key: string): EncryptedSqliteSaver {
    const db = mc.open(path);
    try {
      db.key(key);
      db.query("SELECT count(*) FROM sqlite_master");
      return new EncryptedSqliteSaver(db);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const { threadId, ns, checkpointId } = ids(config);
    if (threadId === undefined) return undefined;
    const [row] = checkpointId
      ? this.db.query(
          `SELECT ${COLUMNS} FROM checkpoints WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`,
          [threadId, ns, checkpointId],
        )
      : this.db.query(
          `SELECT ${COLUMNS} FROM checkpoints WHERE thread_id = ? AND checkpoint_ns = ? ORDER BY checkpoint_id DESC LIMIT 1`,
          [threadId, ns],
        );
    return row && this.toTuple(row);
  }

  async *list(
    config: RunnableConfig,
    options: CheckpointListOptions = {},
  ): AsyncGenerator<CheckpointTuple> {
    const { threadId, checkpointId } = ids(config);
    const where: string[] = [];
    const params: string[] = [];
    const add = (clause: string, value: string | undefined) => {
      if (value === undefined) return;
      where.push(clause);
      params.push(value);
    };
    add("thread_id = ?", threadId);
    add("checkpoint_ns = ?", config.configurable?.checkpoint_ns);
    add("checkpoint_id = ?", checkpointId);
    add("checkpoint_id < ?", options.before?.configurable?.checkpoint_id);
    const sql = `SELECT ${COLUMNS} FROM checkpoints ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY checkpoint_id DESC`;
    let remaining = options.limit ?? Number.POSITIVE_INFINITY;
    for (const row of this.db.query(sql, params)) {
      if (remaining <= 0) return;
      const tuple = await this.toTuple(row);
      const metadata = (tuple.metadata ?? {}) as Record<string, unknown>;
      const filter = Object.entries(options.filter ?? {});
      if (!filter.every(([key, value]) => metadata[key] === value)) continue;
      remaining -= 1;
      yield tuple;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const { threadId, ns, checkpointId: parentId } = ids(config);
    if (threadId === undefined) throw new Error("put: config.configurable.thread_id is missing");
    const [type, body] = await this.serde.dumpsTyped(checkpoint);
    const [, meta] = await this.serde.dumpsTyped(metadata);
    this.db.query(`INSERT OR REPLACE INTO checkpoints (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
      threadId,
      ns,
      checkpoint.id,
      parentId ?? "",
      type,
      body,
      meta,
    ]);
    return configOf(threadId, ns, checkpoint.id);
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
    taskPath = "",
  ): Promise<void> {
    const { threadId, ns, checkpointId } = ids(config);
    if (threadId === undefined || checkpointId === undefined) {
      throw new Error("putWrites: config.configurable needs thread_id and checkpoint_id");
    }
    const rows = await Promise.all(
      writes.map(async ([channel, value], index) => {
        const [type, body] = await this.serde.dumpsTyped(value);
        // Special channels (error, interrupt, ...) take fixed negative indexes and replace the
        // previous write; a regular write that already exists is kept, as in MemorySaver.
        const idx = WRITES_IDX_MAP[channel] ?? index;
        return {
          idx,
          params: [threadId, ns, checkpointId, taskId, idx, taskPath, channel, type, body],
        };
      }),
    );
    this.db.exec("BEGIN");
    try {
      for (const { idx, params } of rows) {
        this.db.query(
          `INSERT OR ${idx < 0 ? "REPLACE" : "IGNORE"} INTO writes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    this.db.query("DELETE FROM checkpoints WHERE thread_id = ?", [threadId]);
    this.db.query("DELETE FROM writes WHERE thread_id = ?", [threadId]);
  }

  private async toTuple(row: Row): Promise<CheckpointTuple> {
    const [threadId, ns, checkpointId, parentId, type] = row as string[];
    return {
      config: configOf(threadId as string, ns as string, checkpointId as string),
      checkpoint: await this.serde.loadsTyped(type as string, bytes(row[5] ?? null)),
      metadata: await this.serde.loadsTyped(type as string, bytes(row[6] ?? null)),
      pendingWrites: await this.pendingWrites(
        threadId as string,
        ns as string,
        checkpointId as string,
      ),
      ...(parentId && { parentConfig: configOf(threadId as string, ns as string, parentId) }),
    };
  }

  /** The stored writes of one checkpoint, in the writesSortKey order the contract requires. */
  private async pendingWrites(
    threadId: string,
    ns: string,
    checkpointId: string,
  ): Promise<CheckpointPendingWrite[]> {
    const rows = this.db.query(
      "SELECT task_path, task_id, idx, channel, type, value FROM writes WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?",
      [threadId, ns, checkpointId],
    ) as [string, string, number, string, string, Uint8Array | null][];
    rows.sort((a, b) =>
      compareWritesSortKeys(writesSortKey(a[0], a[1], a[2]), writesSortKey(b[0], b[1], b[2])),
    );
    return Promise.all(
      rows.map(async ([, taskId, , channel, type, value]) => [
        taskId,
        channel,
        await this.serde.loadsTyped(type, bytes(value)),
      ]),
    );
  }
}
