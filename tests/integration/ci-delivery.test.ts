import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { posix, resolve, win32 } from "node:path";

interface Step {
  uses?: string;
  run?: string;
  if?: string;
  "continue-on-error"?: boolean;
  "working-directory"?: string;
  with?: Record<string, unknown>;
}
interface Job {
  if?: string;
  needs?: string;
  "continue-on-error"?: boolean;
  strategy?: { matrix: { os: string[] } };
  steps: Step[];
}
const root = resolve(import.meta.dir, "../..");
const ci = Bun.YAML.parse(readFileSync(`${root}/.github/workflows/ci.yml`, "utf8")) as {
  jobs: Record<string, Job>;
};

/** The workflow's job, or a failure naming it: a renamed job must not pass silently. */
function job(name: string): Job {
  const found = ci.jobs[name];
  if (!found) throw new Error(`ci.yml has no job named ${name}`);
  return found;
}

test("S9: attestation predicate rejects PRs and every non-delivery event/ref", () => {
  const condition = job("attest-native-libs").if ?? "false";
  for (const event of ["push", "pull_request", "pull_request_target", "workflow_dispatch"]) {
    for (const ref of [
      "refs/heads/dev",
      "refs/heads/main",
      "refs/heads/feature",
      "refs/tags/main",
      "refs/pull/1/merge",
      "",
    ]) {
      const expression = condition
        .replaceAll("github.event_name", JSON.stringify(event))
        .replaceAll("github.ref", JSON.stringify(ref));
      const actual = new Function(`return (${expression});`)();
      expect(Boolean(actual)).toBe(
        event === "push" && ["refs/heads/dev", "refs/heads/main"].includes(ref),
      );
    }
  }
});

test("S9: both runner jobs require successful native production", () => {
  expect(job("check").strategy?.matrix.os).toEqual(["ubuntu-latest", "windows-latest"]);
  for (const name of ["check", "attest-native-libs"]) {
    const found = job(name);
    expect(found.needs).toBe("native-libs");
    expect(found["continue-on-error"]).toBeUndefined();
  }
  expect(job("check").if).toBeUndefined();
  expect(job("native-libs")["continue-on-error"]).toBeUndefined();
});

test("S9: checksum validation is mandatory between download and attestation", () => {
  const steps = job("attest-native-libs").steps;
  const download = steps.findIndex((step) => step.uses?.startsWith("actions/download-artifact@"));
  const verify = steps.findIndex((step) => step.run?.includes("sha256sum --check --strict"));
  const attest = steps.findIndex((step) =>
    step.uses?.startsWith("actions/attest-build-provenance@"),
  );
  expect(download).toBeGreaterThanOrEqual(0);
  expect(verify).toBeGreaterThan(download);
  expect(attest).toBeGreaterThan(verify);
  const check = steps[verify];
  if (!check) throw new Error("attest-native-libs has no sha256sum --check step");
  expect(check.if).toBeUndefined();
  expect(check["continue-on-error"]).toBeUndefined();
  expect(check["working-directory"]).toBe(".local/build/native");
  expect(check.run).toContain(
    "jq -r '.libraries[] | to_entries[] | \"\\(.value.sha256)  \\(.key)/\\(.value.file)\"' manifest.json",
  );
});

test("S9: named downloads use a destination normalized correctly on either OS", () => {
  for (const name of ["check", "attest-native-libs"]) {
    const input = job(name).steps.find((step) =>
      step.uses?.startsWith("actions/download-artifact@"),
    )?.with;
    expect(input?.name).toBe("native-libs");
    const path = String(input?.path);
    expect(posix.resolve("/work", path, "manifest.json")).toBe(
      "/work/.local/build/native/manifest.json",
    );
    expect(win32.resolve("C:\\work", path, "manifest.json")).toBe(
      "C:\\work\\.local\\build\\native\\manifest.json",
    );
  }
});

test("S9: CI action pins preserve existing release/SHA pairs", () => {
  const pins = (file: string) =>
    [
      ...readFileSync(`${root}/.github/workflows/${file}`, "utf8").matchAll(
        /uses: (\S+) # (v[\d.]+)/g,
      ),
    ].map((match) => `${match[1]} # ${match[2]}`);
  const prior = new Set(pins("llama-server.yml"));
  // setup-bun is already used by baseline ci.yml, not by llama-server.yml.
  prior.add("oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0");
  for (const pin of pins("ci.yml")) expect(prior.has(pin)).toBe(true);
});
