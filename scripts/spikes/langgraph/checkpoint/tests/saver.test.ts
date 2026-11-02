import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  type Checkpoint,
  type CheckpointMetadata,
  emptyCheckpoint,
  uuid6,
} from "@langchain/langgraph-checkpoint";
import { devLayout } from "@/shared/model/dev-layout";
import { repoRoot } from "../../../../shared/repo-root";
import { Sqlite3mc } from "../../../encrypted-sqlite/sqlite3mc";
import { EncryptedSqliteSaver, INSECURE_SPIKE_KEY } from "../saver";

const layout = devLayout(repoRoot());
const library = join(layout.local.build, "sqlite", "libsqlite3mc.so");

// The library is a local build (bun scripts/spikes/encrypted-sqlite/build-artifacts.ts); CI has none.
describe.skipIf(!existsSync(library))("EncryptedSqliteSaver", () => {
  let folder: string;
  let saver: EncryptedSqliteSaver;

  beforeEach(() => {
    mkdirSync(layout.temp.tests, { recursive: true });
    folder = mkdtempSync(join(layout.temp.tests, "checkpoint-saver-"));
    const mc = Sqlite3mc.load(library, "3.54.0", "dispatch-table");
    saver = EncryptedSqliteSaver.open(mc, join(folder, "checkpoints.db"), INSECURE_SPIKE_KEY);
  });

  afterEach(() => {
    saver.close();
    rmSync(folder, { recursive: true, force: true });
  });

  const thread = (id: string, checkpointId?: string): RunnableConfig => ({
    configurable: {
      thread_id: id,
      checkpoint_ns: "",
      ...(checkpointId && { checkpoint_id: checkpointId }),
    },
  });

  function checkpoint(messages: string[]): Checkpoint {
    return { ...emptyCheckpoint(), id: uuid6(-1), channel_values: { messages } };
  }

  function metadata(step: number): CheckpointMetadata {
    return { source: "loop", step, parents: {} };
  }

  /** Puts a chain of checkpoints on one thread, each one the parent of the next. */
  async function chain(threadId: string, steps: number): Promise<Checkpoint[]> {
    const saved: Checkpoint[] = [];
    let config = thread(threadId);
    for (let step = 0; step < steps; step++) {
      const next = checkpoint([`message ${step}`]);
      config = await saver.put(config, next, metadata(step), {});
      saved.push(next);
    }
    return saved;
  }

  test("put then getTuple returns the checkpoint, its metadata and its config", async () => {
    const saved = checkpoint(["hello"]);
    const config = await saver.put(thread("t1"), saved, metadata(0), {});
    expect(config).toEqual(thread("t1", saved.id));
    const latest = await saver.getTuple(thread("t1"));
    expect(latest?.checkpoint).toEqual(saved);
    expect(latest?.metadata).toEqual(metadata(0));
    expect(latest?.config).toEqual(thread("t1", saved.id));
    expect(latest?.parentConfig).toBeUndefined();
    expect(latest?.pendingWrites).toEqual([]);
    expect(await saver.getTuple(thread("other"))).toBeUndefined();
  });

  test("a checkpoint links to its parent and getTuple finds a given id", async () => {
    const [first, second] = await chain("t1", 2);
    const latest = await saver.getTuple(thread("t1"));
    expect(latest?.checkpoint.id).toBe(second?.id as string);
    expect(latest?.parentConfig).toEqual(thread("t1", first?.id));
    const older = await saver.getTuple(thread("t1", first?.id));
    expect(older?.checkpoint).toEqual(first as Checkpoint);
    expect(older?.parentConfig).toBeUndefined();
  });

  test("list returns newest first and honors limit, before and filter", async () => {
    const saved = await chain("t1", 3);
    await chain("t2", 1);
    const ids = async (options?: Parameters<EncryptedSqliteSaver["list"]>[1]) => {
      const found: string[] = [];
      for await (const tuple of saver.list(thread("t1"), options)) found.push(tuple.checkpoint.id);
      return found;
    };
    const newestFirst = saved.map((one) => one.id).reverse();
    expect(await ids()).toEqual(newestFirst);
    expect(await ids({ limit: 2 })).toEqual(newestFirst.slice(0, 2));
    expect(await ids({ before: thread("t1", saved[2]?.id) })).toEqual(newestFirst.slice(1));
    expect(await ids({ filter: { step: 1 } })).toEqual([saved[1]?.id as string]);
  });

  test("putWrites keeps writesSortKey order, ignores repeated writes and replaces special ones", async () => {
    const [saved] = await chain("t1", 1);
    const config = thread("t1", saved?.id);
    await saver.putWrites(config, [["b", "second task"]], "task-b", "~b");
    await saver.putWrites(
      config,
      [
        ["a", 1],
        ["a", 2],
      ],
      "task-a",
      "~a",
    );
    await saver.putWrites(config, [["a", "ignored"]], "task-a", "~a");
    await saver.putWrites(config, [["__error__", "first error"]], "task-c", "~c");
    await saver.putWrites(config, [["__error__", "last error"]], "task-c", "~c");
    expect((await saver.getTuple(config))?.pendingWrites).toEqual([
      ["task-a", "a", 1],
      ["task-a", "a", 2],
      ["task-b", "b", "second task"],
      ["task-c", "__error__", "last error"],
    ]);
  });

  test("deleteThread removes the thread's checkpoints and writes only", async () => {
    const [saved] = await chain("t1", 1);
    await chain("t2", 1);
    await saver.putWrites(thread("t1", saved?.id), [["a", 1]], "task-a");
    await saver.deleteThread("t1");
    expect(await saver.getTuple(thread("t1"))).toBeUndefined();
    expect(await saver.getTuple(thread("t1", saved?.id))).toBeUndefined();
    expect((await saver.getTuple(thread("t2")))?.checkpoint.channel_values).toEqual({
      messages: ["message 0"],
    });
  });

  test("the store survives a reopen with the key and rejects a wrong key", async () => {
    const [saved] = await chain("t1", 1);
    saver.close();
    const mc = Sqlite3mc.load(library, "3.54.0", "dispatch-table");
    const path = join(folder, "checkpoints.db");
    expect(() => EncryptedSqliteSaver.open(mc, path, "insecure-wrong-key")).toThrow(
      "file is not a database",
    );
    saver = EncryptedSqliteSaver.open(mc, path, INSECURE_SPIKE_KEY);
    expect((await saver.getTuple(thread("t1")))?.checkpoint).toEqual(saved as Checkpoint);
  });
});
