// T11 spike check, Linux entry: the data key wrapped by systemd-creds --user (host key + TPM2),
// plus the recovery key and the passphrase fallback.
// Run from source:  bun scripts/dev-env/run.ts bun scripts/spikes/key-wrapping/check.ts
// Compile and run:  see docs/research/spike-key-wrapping.md
import { runEnvelopeChecks } from "./envelope-checks";
import { containsBytes, createReport, expect, sameBytes } from "./report";
import { unwrapWithTpm, wrapWithTpm } from "./systemd-creds";

// systemd v262 src/shared/creds-util.h: CRED_AES256_GCM_BY_HOST_AND_TPM2_HMAC_SCOPED_PINNED_SRK.
const HOST_TPM2_SCOPED_PINNED_SRK = "2a1f877a4275431ab3f9ed1f5d8f6601";

const report = createReport("T11 key wrapping, Linux");
const key = crypto.getRandomValues(new Uint8Array(32));

await report.check("a TPM2 round trip", async () => {
  const started = performance.now();
  const credential = await wrapWithTpm(key);
  const wrapMs = Math.round(performance.now() - started);
  const raw = new Uint8Array(Buffer.from(new TextDecoder().decode(credential), "base64"));
  const keyType = Buffer.from(raw.subarray(0, 16)).toString("hex");
  expect(keyType === HOST_TPM2_SCOPED_PINNED_SRK, `key type ${keyType}`);
  expect(!containsBytes(raw, key), "the key appears in the credential");
  const unwrapStarted = performance.now();
  expect(sameBytes(await unwrapWithTpm(credential), key), "round trip differs");
  const unwrapMs = Math.round(performance.now() - unwrapStarted);
  return `${raw.length}-byte credential, host+tpm2 scoped to this user, pinned SRK; wrap ${wrapMs} ms, unwrap ${unwrapMs} ms`;
});

await report.check("b TPM2 rejects tamper and a wrong name", async () => {
  const credential = await wrapWithTpm(key);
  const raw = Buffer.from(new TextDecoder().decode(credential), "base64");
  raw[raw.length >> 1] = (raw[raw.length >> 1] ?? 0) ^ 1;
  const failures: string[] = [];
  for (const [label, attempt] of [
    ["tampered", () => unwrapWithTpm(new TextEncoder().encode(raw.toString("base64")))],
    ["wrong name", () => unwrapWithTpm(credential, "goop-other")],
  ] as const) {
    try {
      await attempt();
    } catch (error) {
      failures.push(
        `${label}: ${error instanceof Error ? error.message.split(": ").pop() : error}`,
      );
      continue;
    }
    throw new Error(`${label} credential was opened`);
  }
  return failures.join("; ");
});

await runEnvelopeChecks(report, key);
report.finish();
