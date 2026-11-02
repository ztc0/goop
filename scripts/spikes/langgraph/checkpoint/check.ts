// T14 spike check: LangGraph on Bun with the encrypted sqlite3mc checkpoint saver. Prints PASS/FAIL
// per item and exits 1 on any FAIL. With --resume it is the second process of item b.
// Run from source:  bun scripts/dev-env/run.ts bun scripts/spikes/langgraph/checkpoint/check.ts
// Compile and run:
//   bun scripts/dev-env/run.ts bun build --compile scripts/spikes/langgraph/checkpoint/check.ts \
//     --outfile .temp/scratch/t14-checkpoint/check
//   GOOP_SPIKE_CACHE=$PWD/.temp/scratch/t14-checkpoint/cache \
//     bun scripts/dev-env/run.ts .temp/scratch/t14-checkpoint/check
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import {
  Annotation,
  Command,
  END,
  getConfig,
  interrupt,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import libraryFile from "../../../../.local/build/sqlite/libsqlite3mc.so" with { type: "file" };
import libraryHashFile from "../../../../.local/build/sqlite/libsqlite3mc.so.sha256" with {
  type: "file",
};
import { installNative, nativeCacheRoot } from "../../encrypted-sqlite/native-cache";
import { Sqlite3mc } from "../../encrypted-sqlite/sqlite3mc";
import { containsBytes, createReport, expect } from "../../key-wrapping/report";
import { EncryptedSqliteSaver, INSECURE_SPIKE_KEY } from "./saver";

const MARKER = "GOOP-CHECKPOINT-MARKER-5c1e9a";
const INTERRUPT_THREAD = "spike-interrupt";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const cacheRoot = nativeCacheRoot(process.env);
const home = process.env.GOOP_HOME;
if (!cacheRoot || !home) {
  process.stderr.write("Run through scripts/dev-env/run.ts (GOOP_HOME is not set)\n");
  process.exit(2);
}
const compiled = import.meta.path.startsWith("/$bunfs/") || import.meta.path.includes("~BUN");
const scratch =
  process.env.GOOP_SPIKE_SCRATCH ??
  join(dirname(home), ".temp", "scratch", "t14-checkpoint", `run-${process.pid}`);
mkdirSync(scratch, { recursive: true });
const dbPath = join(scratch, "checkpoints.db");
const hash = readFileSync(libraryHashFile, "utf8").trim();
const mc = Sqlite3mc.load(
  await installNative(libraryFile, "libsqlite3mc.so", hash, cacheRoot),
  "3.54.0",
  "dispatch-table",
);

/** Awaits through nested async calls and timers, then reads the thread id from the run context. */
async function threadIdAfterAwaits(depth: number): Promise<string> {
  await sleep(2);
  if (depth > 0) return threadIdAfterAwaits(depth - 1);
  await Promise.all([sleep(1), Promise.resolve()]);
  return String(getConfig().configurable?.thread_id);
}

// What each run of the "ask" node saw after its awaits (AsyncLocalStorage, item c).
const seenInNode: string[] = [];
let childSeen: string[] = [];

function interruptGraph(saver: EncryptedSqliteSaver) {
  return new StateGraph(MessagesAnnotation)
    .addNode("prepare", () => ({ messages: [new AIMessage("Which city do you want to work in?")] }))
    .addNode("ask", async () => {
      seenInNode.push(await threadIdAfterAwaits(3));
      const answer = interrupt({ question: "city" }) as string;
      return { messages: [new HumanMessage(answer)] };
    })
    .addNode("finish", () => ({ messages: [new AIMessage("Saved.")] }))
    .addEdge(START, "prepare")
    .addEdge("prepare", "ask")
    .addEdge("ask", "finish")
    .addEdge("finish", END)
    .compile({ checkpointer: saver });
}

const threadConfig = { configurable: { thread_id: INTERRUPT_THREAD } };

if (process.argv.includes("--resume")) {
  const saver = EncryptedSqliteSaver.open(mc, dbPath, INSECURE_SPIKE_KEY);
  const result = await interruptGraph(saver).invoke(
    new Command({ resume: `Valencia ${MARKER}` }),
    threadConfig,
  );
  saver.close();
  const messages = result.messages.map((message) => String(message.content));
  process.stdout.write(`RESUMED ${JSON.stringify({ pid: process.pid, messages, seenInNode })}\n`);
  process.exit(0);
}

const report = createReport("T14 LangGraph encrypted checkpointer, Linux");
const saver = EncryptedSqliteSaver.open(mc, dbPath, INSECURE_SPIKE_KEY);

await report.check("a StateGraph runs to completion with the encrypted saver", async () => {
  const Chat = Annotation.Root({ ...MessagesAnnotation.spec, turns: Annotation<number> });
  const graph = new StateGraph(Chat)
    .addNode("think", () => ({ messages: [new AIMessage("Looking for offers.")], turns: 1 }))
    .addNode("reply", ({ turns }) => ({ messages: [new AIMessage("Found 2.")], turns: turns + 1 }))
    .addEdge(START, "think")
    .addEdge("think", "reply")
    .addEdge("reply", END)
    .compile({ checkpointer: saver });
  const config = { configurable: { thread_id: "spike-chat" } };
  const result = await graph.invoke({ messages: [new HumanMessage(`Hi ${MARKER}`)] }, config);
  expect(result.messages.length === 3 && result.turns === 2, JSON.stringify(result));
  let checkpoints = 0;
  for await (const _ of saver.list(config)) checkpoints++;
  const restored = await graph.getState(config);
  expect(restored.values.messages.length === 3, "getState lost messages");
  return `3 messages, turns 2, ${checkpoints} checkpoints stored, getState restores them`;
});

await report.check("b interrupt() pauses; a second process resumes with Command", async () => {
  await interruptGraph(saver).invoke(
    { messages: [new HumanMessage(`Hi ${MARKER}`)] },
    threadConfig,
  );
  const paused = await interruptGraph(saver).getState(threadConfig);
  const question = paused.tasks[0]?.interrupts[0]?.value as { question?: string } | undefined;
  expect(paused.next.join() === "ask" && question?.question === "city", "run did not pause at ask");
  saver.close();
  const child = Bun.spawnSync([process.execPath, ...(compiled ? [] : [Bun.main]), "--resume"], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GOOP_SPIKE_SCRATCH: scratch },
  });
  const line = child.stdout
    .toString()
    .split("\n")
    .find((one) => one.startsWith("RESUMED "));
  expect(
    child.exitCode === 0 && line !== undefined,
    `child exit ${child.exitCode}: ${child.stderr}`,
  );
  const resumed = JSON.parse(line?.slice("RESUMED ".length) ?? "{}");
  childSeen = resumed.seenInNode;
  const messages = resumed.messages as string[];
  expect(messages.at(-2) === `Valencia ${MARKER}` && messages.at(-1) === "Saved.", line ?? "");
  return `paused at "ask" (pid ${process.pid}); pid ${resumed.pid} resumed: ${messages.length} messages, last "${messages.at(-1)}"`;
});

await report.check("c AsyncLocalStorage survives nested awaits and timers on Bun", async () => {
  const expected = [INTERRUPT_THREAD];
  expect(JSON.stringify(seenInNode) === JSON.stringify(expected), `parent saw ${seenInNode}`);
  expect(JSON.stringify(childSeen) === JSON.stringify(expected), `child saw ${childSeen}`);
  const storage = new AsyncLocalStorage<string>();
  const seen = await storage.run("ctx", async () => {
    const values: (string | undefined)[] = [];
    await sleep(1);
    values.push(storage.getStore());
    values.push(
      await new Promise<string | undefined>((ok) => setTimeout(() => ok(storage.getStore()), 1)),
    );
    const parallel = [1, 2].map(async () => {
      await sleep(1);
      return storage.getStore();
    });
    values.push(...(await Promise.all(parallel)));
    queueMicrotask(() => values.push(storage.getStore()));
    await Bun.sleep(1);
    return values;
  });
  expect(seen.every((value) => value === "ctx") && seen.length === 5, JSON.stringify(seen));
  return "getConfig() and interrupt() worked after 4 nested awaits + setTimeout in both processes; raw ALS kept its store across setTimeout, Promise.all, queueMicrotask, Bun.sleep";
});

await report.check("d the file has no plaintext and a wrong key cannot open it", async () => {
  const file = new Uint8Array(readFileSync(dbPath));
  for (const needle of [MARKER, "Valencia", "Looking for offers", "SQLite format 3"]) {
    expect(!containsBytes(file, new TextEncoder().encode(needle)), `"${needle}" is in the file`);
  }
  let error = "";
  try {
    EncryptedSqliteSaver.open(mc, dbPath, "insecure-wrong-key").close();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  expect(error.includes("file is not a database"), `wrong key: ${error || "opened"}`);
  return `${file.length} bytes, no marker, no SQLite header; wrong key -> ${error}`;
});

rmSync(scratch, { recursive: true, force: true });
report.finish();
