// T11 spike check, Windows entry: the data key wrapped by DPAPI (user scope) through bun:ffi,
// plus the recovery key and the passphrase fallback.
// Compile on Linux:  bun scripts/dev-env/run.ts bun build --compile --target=bun-windows-x64 \
//   scripts/spikes/key-wrapping/check-windows.ts --outfile .local/build/key-wrapping/goop-key-check.exe
// Item u needs two helper runs before the report, each a separate process:
//   goop-key-check.exe --wrap <dir>     as the owner: writes <dir>\blob.bin (a fresh random key)
//   goop-key-check.exe --unwrap <dir>   as another user: writes <dir>\other.txt
//   goop-key-check.exe --other <dir>    as the owner: the report, with item u read from <dir>
import { unwrapWithDpapi, wrapWithDpapi } from "./dpapi";
import { runEnvelopeChecks } from "./envelope-checks";
import { containsBytes, createReport, expect, sameBytes } from "./report";

const [mode, dir] = process.argv.slice(2);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

if (mode === "--wrap" && dir) {
  await Bun.write(`${dir}\\blob.bin`, wrapWithDpapi(crypto.getRandomValues(new Uint8Array(32))));
  process.exit(0);
}

if (mode === "--unwrap" && dir) {
  const blob = await Bun.file(`${dir}\\blob.bin`).bytes();
  let result: string;
  try {
    result = `opened: ${unwrapWithDpapi(blob).length} bytes`;
  } catch (error) {
    result = `rejected: ${message(error)}`;
  }
  await Bun.write(`${dir}\\other.txt`, `${process.env.USERNAME}: ${result}\n`);
  process.exit(0);
}

const report = createReport("T11 key wrapping, Windows");
const key = crypto.getRandomValues(new Uint8Array(32));

await report.check("a DPAPI round trip", async () => {
  const started = performance.now();
  const blob = wrapWithDpapi(key);
  const wrapMs = (performance.now() - started).toFixed(1);
  expect(!containsBytes(blob, key), "the key appears in the blob");
  const unwrapStarted = performance.now();
  expect(sameBytes(unwrapWithDpapi(blob), key), "round trip differs");
  const unwrapMs = (performance.now() - unwrapStarted).toFixed(1);
  return `${blob.length}-byte blob, user scope, entropy set; wrap ${wrapMs} ms, unwrap ${unwrapMs} ms`;
});

await report.check("b DPAPI rejects tamper and a wrong entropy", async () => {
  const blob = wrapWithDpapi(key);
  const raw = new Uint8Array(blob);
  raw[raw.length >> 1] = (raw[raw.length >> 1] ?? 0) ^ 1;
  const failures: string[] = [];
  for (const [label, attempt] of [
    ["tampered", () => unwrapWithDpapi(raw)],
    ["wrong entropy", () => unwrapWithDpapi(blob, "goop-other")],
    ["no entropy", () => unwrapWithDpapi(blob, null)],
  ] as const) {
    try {
      attempt();
    } catch (error) {
      failures.push(`${label}: ${message(error).split(": ").pop()}`);
      continue;
    }
    throw new Error(`${label} blob was opened`);
  }
  return failures.join("; ");
});

if (mode === "--other" && dir) {
  await report.check("u another user cannot unwrap", async () => {
    const blob = await Bun.file(`${dir}\\blob.bin`).bytes();
    expect(unwrapWithDpapi(blob).length === 32, "the owner cannot open its own blob");
    const other = Bun.file(`${dir}\\other.txt`);
    expect(await other.exists(), "the other user wrote no result");
    const line = (await other.text()).trim();
    expect(line.includes(": rejected: "), line);
    return `owner ${process.env.USERNAME} opened it; ${line}`;
  });
}

await runEnvelopeChecks(report, key);
report.finish();
