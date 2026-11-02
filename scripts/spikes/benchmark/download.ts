// T13 spike: downloads the pinned GGUF files into GOOP_HOME/models/<id>/ and checks their size
// and sha256. A partial download resumes; a file that fails the check is deleted, never used.
// Run: bun scripts/dev-env/run.ts bun scripts/spikes/benchmark/download.ts [model-id ...]
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { downloadUrl, MODELS, type ModelFile, modelPath } from "./models";

const home = process.env.GOOP_HOME;
if (!home) {
  process.stderr.write("Set GOOP_HOME (run through scripts/dev-env/run.ts)\n");
  process.exit(2);
}
const wanted = process.argv.slice(2);
const unknown = wanted.filter((id) => !MODELS.some((model) => model.id === id));
if (unknown.length > 0) {
  process.stderr.write(`unknown model id: ${unknown.join(", ")}\n`);
  process.exit(2);
}

async function sha256File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

async function fetchModel(model: ModelFile): Promise<void> {
  const target = modelPath(home as string, model);
  if (existsSync(target)) {
    process.stdout.write(`${model.id}: present, checking sha256\n`);
    if ((await sha256File(target)) === model.sha256) return;
    throw new Error(`${model.id}: ${target} does not match its pinned sha256; delete it by hand`);
  }
  mkdirSync(join(home as string, "models", model.id), { recursive: true, mode: 0o700 });
  const partial = `${target}.part`;
  // curl resumes a partial file (-C -), fails on HTTP errors and follows the CDN redirect.
  const curl = Bun.spawn(
    ["curl", "--fail", "--location", "--continue-at", "-", "--output", partial, downloadUrl(model)],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await curl.exited) !== 0) throw new Error(`${model.id}: curl failed`);
  const size = statSync(partial).size;
  if (size !== model.bytes) {
    rmSync(partial);
    throw new Error(`${model.id}: ${size} bytes, expected ${model.bytes}; partial file deleted`);
  }
  const digest = await sha256File(partial);
  if (digest !== model.sha256) {
    rmSync(partial);
    throw new Error(`${model.id}: sha256 ${digest}, expected ${model.sha256}; file deleted`);
  }
  renameSync(partial, target);
}

for (const model of MODELS.filter((entry) => wanted.length === 0 || wanted.includes(entry.id))) {
  await fetchModel(model);
  process.stdout.write(`${model.id}: OK ${model.sha256}\n`);
}
