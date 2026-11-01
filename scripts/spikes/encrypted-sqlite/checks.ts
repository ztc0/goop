// T10 spike checks: sqlite3mc (encryption) + FTS5 + sqlite-vec through bun:ffi, next to bun:sqlite.
// Prints PASS/FAIL per item and exits 1 on any FAIL. The entry files embed the native libraries
// for one platform and call runSpikeChecks: check.ts (Linux) and check-windows.ts (Windows).
import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { installNative, nativeCacheRoot } from "./native-cache";
import { type Connection, Sqlite3mc } from "./sqlite3mc";

/** One embedded native library: its file import path, its cache file name and its pinned hash. */
export interface NativeFile {
  file: string;
  name: string;
  sha256: string;
}

export interface SpikeNatives {
  library: NativeFile;
  vec: NativeFile;
  /** How the wrapper finds the SQLite functions: the Linux build's tables or the DLL's exports. */
  mode: "dispatch-table" | "exports";
}

const SQLITE_VERSION = "3.54.0";
const MARKER = "GOOP-PLAINTEXT-MARKER-7f3a9c";
// Spike-only passphrases. Never a real key.
const KEY = "insecure-spike-key-do-not-use";
const WRONG_KEY = "insecure-wrong-key";

export async function runSpikeChecks(natives: SpikeNatives): Promise<never> {
  const results: { item: string; ok: boolean; detail: string }[] = [];

  function check(item: string, body: () => string): void {
    try {
      results.push({ item, ok: true, detail: body() });
    } catch (error) {
      results.push({
        item,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function expect(condition: boolean, message: string): void {
    if (!condition) throw new Error(message);
  }

  // GOOP_SPIKE_CACHE points at an empty folder to prove the copy out of /$bunfs/ works.
  const cacheRoot = nativeCacheRoot(process.env);
  if (!cacheRoot) {
    process.stderr.write(
      "Set GOOP_SPIKE_CACHE or GOOP_HOME (scripts/dev-env/run.ts), or LOCALAPPDATA on Windows\n",
    );
    process.exit(2);
  }
  const home = process.env.GOOP_HOME;
  const compiled = import.meta.path.startsWith("/$bunfs/") || import.meta.path.includes("~BUN");
  // The probe child reuses the parent's scratch folder through GOOP_SPIKE_SCRATCH.
  const scratch =
    process.env.GOOP_SPIKE_SCRATCH ??
    join(
      home ? join(dirname(home), ".temp", "scratch") : tmpdir(),
      `encrypted-sqlite-${process.pid}`,
    );
  mkdirSync(scratch, { recursive: true });
  const dbPath = join(scratch, "spike.db");

  const { library, vec } = natives;
  const libraryPath = await installNative(library.file, library.name, library.sha256, cacheRoot);
  const vecPath = await installNative(vec.file, vec.name, vec.sha256, cacheRoot);
  const mc = Sqlite3mc.load(libraryPath, SQLITE_VERSION, natives.mode);
  process.stdout.write(
    `mode: ${compiled ? "compiled executable" : "bun source"}; ${process.platform}-${process.arch}; sqlite3mc ${mc.version()} via ${mc.mode}\n`,
  );
  process.stdout.write(
    `embedded: ${library.file}, ${vec.file}\ncache: ${libraryPath}, ${vecPath}\n`,
  );

  function openKeyed(key: string): Connection {
    const db = mc.open(dbPath);
    db.key(key);
    return db;
  }

  const vector = (values: number[]) => new Float32Array(values);

  // Probe, run in a child process because it may crash: vec0.so keeps one global sqlite3_api
  // pointer, so loading it into bun:sqlite after sqlite3mc may redirect the sqlite3mc calls.
  if (process.argv.includes("--probe-shared-vec0")) {
    const step = (name: string) => process.stdout.write(`step: ${name}\n`);
    const encrypted = openKeyed(KEY);
    encrypted.loadExtension(vecPath, "sqlite3_vec_init");
    encrypted.exec("CREATE VIRTUAL TABLE probe_vec USING vec0(embedding float[4])");
    encrypted.query("INSERT INTO probe_vec(rowid, embedding) VALUES (1, ?)", [
      vector([0, 1, 0, 0]),
    ]);
    step("vec0 loaded into sqlite3mc, probe_vec written");
    const plain = new Database(":memory:");
    plain.loadExtension(vecPath, "sqlite3_vec_init");
    step("vec0 loaded into bun:sqlite");
    const bunVec = plain.query("SELECT vec_version() AS v").get() as { v: string };
    step(`bun:sqlite vec_version ${bunVec.v}`);
    const knn = encrypted.query("SELECT rowid FROM probe_vec WHERE embedding MATCH ? AND k = 1", [
      vector([0, 1, 0, 0]),
    ]);
    process.stdout.write(
      `bun:sqlite vec ${bunVec.v}; sqlite3mc KNN after it -> ${JSON.stringify(knn)}\n`,
    );
    plain.close();
    encrypted.close();
    process.exit(0);
  }

  check("a) keyed DB with FTS5 + vec0: MATCH and KNN", () => {
    const db = openKeyed(KEY);
    try {
      db.loadExtension(vecPath, "sqlite3_vec_init");
      db.exec("CREATE VIRTUAL TABLE offers_fts USING fts5(title, body)");
      db.exec("CREATE VIRTUAL TABLE offers_vec USING vec0(embedding float[4])");
      db.exec("CREATE TABLE notes(id INTEGER PRIMARY KEY, text TEXT)");
      const offers = [
        ["Backend engineer", "TypeScript, LangGraph and SQLite"],
        ["Frontend engineer", "React and CSS"],
        ["Data engineer", "Python and Spark"],
      ];
      offers.forEach(([title, body], index) => {
        db.query("INSERT INTO offers_fts(rowid, title, body) VALUES (?, ?, ?)", [
          index + 1,
          title as string,
          body as string,
        ]);
      });
      db.query("INSERT INTO notes(text) VALUES (?)", [MARKER]);
      db.query("INSERT INTO offers_fts(rowid, title, body) VALUES (?, ?, ?)", [
        4,
        "Marker",
        MARKER,
      ]);
      const embeddings = [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0.9, 0.1, 0, 0],
      ];
      embeddings.forEach((values, index) => {
        db.query("INSERT INTO offers_vec(rowid, embedding) VALUES (?, ?)", [
          index + 1,
          vector(values),
        ]);
      });
      const match = db.query(
        "SELECT rowid FROM offers_fts WHERE offers_fts MATCH ? ORDER BY rank",
        ['"langgraph"'],
      );
      expect(JSON.stringify(match) === "[[1]]", `FTS5 MATCH returned ${JSON.stringify(match)}`);
      const knn = db.query(
        "SELECT rowid, distance FROM offers_vec WHERE embedding MATCH ? AND k = 2 ORDER BY distance",
        [vector([1, 0, 0, 0])],
      );
      const ids = knn.map((row) => row[0]);
      expect(JSON.stringify(ids) === "[1,4]", `vec0 KNN returned ${JSON.stringify(knn)}`);
      const [version] = db.query("SELECT vec_version()");
      return `FTS5 MATCH -> [1]; KNN k=2 -> ${JSON.stringify(knn)}; ${version?.[0]}`;
    } finally {
      db.close();
    }
  });

  check("b) reopen with the right key: data readable", () => {
    const db = openKeyed(KEY);
    try {
      db.loadExtension(vecPath, "sqlite3_vec_init");
      const notes = db.query("SELECT text FROM notes");
      expect(notes[0]?.[0] === MARKER, `notes returned ${JSON.stringify(notes)}`);
      const match = db.query("SELECT rowid FROM offers_fts WHERE offers_fts MATCH ?", ['"react"']);
      expect(
        JSON.stringify(match) === "[[2]]",
        `FTS5 after reopen returned ${JSON.stringify(match)}`,
      );
      const knn = db.query("SELECT rowid FROM offers_vec WHERE embedding MATCH ? AND k = 1", [
        vector([0, 0, 1, 0]),
      ]);
      expect(JSON.stringify(knn) === "[[3]]", `KNN after reopen returned ${JSON.stringify(knn)}`);
      return "notes, FTS5 and vec0 rows read back";
    } finally {
      db.close();
    }
  });

  check("c) reopen with a wrong key: sqlite_master unreadable", () => {
    const db = openKeyed(WRONG_KEY);
    try {
      let error = "";
      try {
        db.query("SELECT count(*) FROM sqlite_master");
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      expect(error !== "", "reading sqlite_master with a wrong key succeeded");
      return `PRAGMA key returned ok; SELECT failed: ${error}`;
    } finally {
      db.close();
    }
  });

  check("d) raw file bytes contain no plaintext marker", () => {
    const bytes = readFileSync(dbPath);
    expect(!bytes.includes(Buffer.from(MARKER)), "marker found in the database file");
    expect(!bytes.includes(Buffer.from("SQLite format 3")), "plain SQLite header found");
    // Control: the same write without a key must leave the marker visible, or this check is blind.
    const plainPath = join(scratch, "plain.db");
    const plain = mc.open(plainPath);
    plain.exec(`CREATE TABLE notes(text TEXT); INSERT INTO notes VALUES ('${MARKER}')`);
    plain.close();
    expect(
      readFileSync(plainPath).includes(Buffer.from(MARKER)),
      "control: marker not in plain DB",
    );
    return `${bytes.length} bytes, no marker, no "SQLite format 3" header (unkeyed control shows it)`;
  });

  check("e) cipher is chacha20", () => {
    const db = openKeyed(KEY);
    try {
      const cipher = db.query("PRAGMA cipher");
      const config = db.query("SELECT sqlite3mc_config('cipher')");
      const name = String(cipher[0]?.[0]).toLowerCase();
      expect(name === "chacha20", `PRAGMA cipher returned ${JSON.stringify(cipher)}`);
      return `PRAGMA cipher -> ${cipher[0]?.[0]}; sqlite3mc_config('cipher') -> ${JSON.stringify(config)}`;
    } finally {
      db.close();
    }
  });

  check("f) bun:sqlite in-memory DB in the same process while sqlite3mc is open", () => {
    const encrypted = openKeyed(KEY);
    const plain = new Database(":memory:");
    try {
      const [bunVersion] = plain.query("SELECT sqlite_version() AS v").all() as { v: string }[];
      plain.run("CREATE VIRTUAL TABLE t USING fts5(body)");
      plain.run("INSERT INTO t(body) VALUES ('hello encrypted world')");
      const hits = plain.query("SELECT count(*) AS n FROM t WHERE t MATCH 'encrypted'").get() as {
        n: number;
      };
      expect(hits.n === 1, `bun:sqlite FTS5 returned ${JSON.stringify(hits)}`);
      const notes = encrypted.query("SELECT text FROM notes");
      expect(notes[0]?.[0] === MARKER, "sqlite3mc read failed while bun:sqlite was open");
      const [mcVersion] = encrypted.query("SELECT sqlite_version()");
      return `bun:sqlite ${bunVersion?.v} (FTS5 ok) and sqlite3mc ${mcVersion?.[0]} side by side`;
    } finally {
      plain.close();
      encrypted.close();
    }
  });

  check("h) PRAGMA compile_options lists ENABLE_FTS5", () => {
    const db = mc.open(join(scratch, "options.db"));
    try {
      const options = db.query("PRAGMA compile_options").map((row) => String(row[0]));
      expect(options.includes("ENABLE_FTS5"), `compile_options: ${options.join(", ")}`);
      const shown = options.filter((option) =>
        /^(ENABLE_FTS5|THREADSAFE=|TEMP_STORE=)/.test(option),
      );
      return `${options.length} options, including ${shown.join(", ")}`;
    } finally {
      db.close();
    }
  });

  for (const { item, ok, detail } of results) {
    process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${item}: ${detail}\n`);
  }

  // Informational only: it documents a risk and does not change the exit code.
  const probe = Bun.spawnSync(
    [process.execPath, ...(compiled ? [] : [Bun.main]), "--probe-shared-vec0"],
    { stdout: "pipe", stderr: "pipe", env: { ...process.env, GOOP_SPIKE_SCRATCH: scratch } },
  );
  const probeSteps = probe.stdout
    .toString()
    .split("\n")
    .filter((line) => line.startsWith("step: ") || line.startsWith("bun:sqlite vec"));
  process.stdout.write(
    `INFO  g) ${vec.name} loaded into bun:sqlite and sqlite3mc in one process: exit ${probe.exitCode}, signal ${probe.signalCode ?? "none"}; last output: ${probeSteps.at(-1) ?? "none"}\n`,
  );
  rmSync(scratch, { recursive: true, force: true });
  process.exit(results.every((result) => result.ok) ? 0 : 1);
}
