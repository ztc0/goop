// T13 spike: runs the benchmark sweep against the T12 llama-server build, one server per config.
// Run: bun scripts/dev-env/run.ts bun scripts/spikes/benchmark/bench.ts [--list] [--only a,b]
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Subprocess } from "bun";
import {
  acceptanceRate,
  type BenchConfig,
  buildArgv,
  cleanEnv,
  filterConfigs,
  parseCli,
  parseMetrics,
  type Summary,
  summarize,
} from "./lib";
import { MODELS, modelPath } from "./models";
import { N_PREDICT, PROMPTS, RUNS, SEED } from "./prompts";
import { SWEEP } from "./sweep";

const REPO = join(import.meta.dir, "../../..");
const SERVER = join(
  REPO,
  ".local/build/llama-server/run-41379281254/linux/llama-server-v0.8.0-linux-x64-vulkan/llama-server",
);
const SCRATCH = join(REPO, ".temp/scratch/benchmark");
const RX_7700S = "PCI_ID=1002:7480";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

let child: Subprocess | undefined;
process.on("exit", () => child?.kill());
process.on("SIGINT", () => {
  child?.kill();
  process.exit(130);
});

function vramFile(): string | undefined {
  for (const card of readdirSync("/sys/class/drm").filter((name) => /^card\d+$/.test(name))) {
    const device = join("/sys/class/drm", card, "device");
    const uevent = existsSync(join(device, "uevent"))
      ? readFileSync(join(device, "uevent"), "utf8")
      : "";
    if (uevent.includes(RX_7700S) && existsSync(join(device, "mem_info_vram_used"))) {
      return join(device, "mem_info_vram_used");
    }
  }
}

async function freePort(): Promise<number> {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = probe.port as number;
  await probe.stop(true);
  return port;
}

interface PromptResult {
  prompt_n: number;
  predicted_n: number;
  prompt_per_second: Summary;
  predicted_per_second: Summary;
  acceptance: number | null;
  draft_n: number;
  draft_n_accepted: number;
}

async function runConfig(config: BenchConfig, home: string, vram: string | undefined) {
  const find = (id: string) => {
    const model = MODELS.find((entry) => entry.id === id);
    const path = model && modelPath(home, model);
    if (!path || !existsSync(path)) throw new Error(`model ${id} is missing at ${path}`);
    return path;
  };
  const apiKey = randomBytes(32).toString("hex");
  // A new 0600 file per run: the key never appears in argv (S24).
  const apiKeyFile = join(SCRATCH, `api-key-${config.label}-${Date.now()}`);
  writeFileSync(apiKeyFile, `${apiKey}\n`, { mode: 0o600, flag: "wx" });
  const port = await freePort();
  const argv = buildArgv({
    server: SERVER,
    model: find(config.model),
    ...(config.draft ? { draft: find(config.draft) } : {}),
    port,
    apiKeyFile,
    flags: config.flags,
  });
  process.stdout.write(`${config.label}: ${argv.join(" ")}\n`);
  const log = join(SCRATCH, "logs", `${config.label}-${Date.now()}.log`);
  const fd = openSync(log, "w", 0o600);
  const env = cleanEnv(process.env, mkdtempSync(join(SCRATCH, "config", "run-")));
  const server = Bun.spawn(argv, { env, stdin: "ignore", stdout: fd, stderr: fd });
  child = server;
  let peak: number | null = null;
  const sampler = setInterval(() => {
    if (vram) peak = Math.max(peak ?? 0, Number(readFileSync(vram, "utf8")));
  }, 200);
  const base = `http://127.0.0.1:${port}`;
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
  try {
    const deadline = Date.now() + 180_000;
    const health = () =>
      fetch(`${base}/health`).then(
        (r) => r.status,
        () => 0,
      );
    while ((await health()) !== 200) {
      if (server.exitCode !== null) throw new Error(`server exited ${server.exitCode}, see ${log}`);
      if (Date.now() > deadline) throw new Error(`no /health 200 after 180 s, see ${log}`);
      await Bun.sleep(500);
    }
    if (readFileSync(log, "utf8").includes("using config file")) {
      throw new Error(`the server read a config file, see ${log}`);
    }
    const complete = async (prompt: string) => {
      const body = {
        prompt,
        n_predict: N_PREDICT,
        temperature: 0,
        cache_prompt: false,
        seed: SEED,
      };
      const response = await fetch(`${base}/completion`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...body, ...config.request }),
      });
      if (!response.ok) throw new Error(`/completion ${response.status}: ${await response.text()}`);
      return ((await response.json()) as { timings: Record<string, number> }).timings;
    };
    const metrics = async () =>
      parseMetrics(await (await fetch(`${base}/metrics`, { headers })).text());
    await complete(PROMPTS.short);
    const prompts: Record<string, PromptResult> = {};
    for (const [name, prompt] of Object.entries(PROMPTS)) {
      const before = await metrics();
      const timings: Record<string, number>[] = [];
      for (let run = 0; run < RUNS; run++) timings.push(await complete(prompt));
      const pick = (key: string) => timings.map((entry) => entry[key] ?? Number.NaN);
      const total = (key: string) => timings.reduce((sum, entry) => sum + (entry[key] ?? 0), 0);
      prompts[name] = {
        prompt_n: pick("prompt_n")[0] as number,
        predicted_n: pick("predicted_n")[0] as number,
        prompt_per_second: summarize(pick("prompt_per_second")),
        predicted_per_second: summarize(pick("predicted_per_second")),
        acceptance: acceptanceRate(before, await metrics()),
        // The per-response counters, to cross-check the /metrics acceptance.
        draft_n: total("draft_n"),
        draft_n_accepted: total("draft_n_accepted"),
      };
    }
    return { argv, log, prompts, vram_peak_mib: peak === null ? null : Math.round(peak / 2 ** 20) };
  } finally {
    clearInterval(sampler);
    server.kill();
    await server.exited;
    closeSync(fd);
    child = undefined;
  }
}

const { list, configs } = (() => {
  try {
    const cli = parseCli(process.argv.slice(2));
    return { list: cli.list, configs: filterConfigs(SWEEP, cli.only) };
  } catch (error) {
    return fail((error as Error).message);
  }
})();
if (list) {
  for (const config of configs)
    process.stdout.write(
      `${config.label}\t${config.flags.join(" ")}${config.draft ? ` -md <${config.draft}>` : ""}` +
        `${config.request ? ` request ${JSON.stringify(config.request)}` : ""}\n`,
    );
  process.exit(0);
}
const home = process.env.GOOP_HOME;
if (!home) fail("Set GOOP_HOME (run through scripts/dev-env/run.ts)");
if (!existsSync(SERVER)) fail(`llama-server is missing at ${SERVER}; unpack T12 run 41379281254`);
// The system config file cannot be redirected through the environment (T12 finding 6).
if (existsSync("/etc/llama.cpp/config.ini")) fail("/etc/llama.cpp/config.ini exists; stop");
for (const dir of ["logs", "config"])
  mkdirSync(join(SCRATCH, dir), { recursive: true, mode: 0o700 });
mkdirSync(join(home, "benchmark"), { recursive: true });
const out = join(home, "benchmark", `results-${new Date().toISOString().slice(0, 10)}.jsonl`);
const vram = vramFile();
if (!vram) process.stdout.write("VRAM: RX 7700S not found in sysfs, peak VRAM is unavailable\n");
const rows = [
  `${"label".padEnd(16)}${["pp t/s", "tg t/s", "short tg", "acc", "acc sh", "VRAM MiB"].map((h) => h.padStart(9)).join("")}`,
];
for (const config of configs) {
  const started = new Date().toISOString();
  try {
    const result = await runConfig(config, home, vram);
    appendFileSync(out, `${JSON.stringify({ started, ...config, ok: true, ...result })}\n`);
    const { offer, short } = result.prompts;
    const cell = (value: number | null | undefined, digits = 1) =>
      (value === null || value === undefined ? "-" : value.toFixed(digits)).padStart(9);
    rows.push(
      config.label.padEnd(16) +
        cell(offer?.prompt_per_second.median) +
        cell(offer?.predicted_per_second.median) +
        cell(short?.predicted_per_second.median) +
        cell(offer?.acceptance, 2) +
        cell(short?.acceptance, 2) +
        cell(result.vram_peak_mib, 0),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendFileSync(out, `${JSON.stringify({ started, ...config, ok: false, error: message })}\n`);
    rows.push(`${config.label.padEnd(16)}FAILED: ${message}`);
  }
}
process.stdout.write(`${rows.join("\n")}\nresults: ${out}\n`);
