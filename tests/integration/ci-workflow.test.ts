import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// The CI chain of trust for the native libraries (odd/tasks/native-library.md, S9) and the
// action pins (docs/development/rules/security.md). Real CI is the only full check; this keeps
// the rules a workflow edit could break silently.

const workflows = resolve(import.meta.dir, "..", "..", ".github", "workflows");

interface Step {
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
}

interface Job {
  if?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  steps: Step[];
}

interface Workflow {
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
}

const ci = Bun.YAML.parse(readFileSync(join(workflows, "ci.yml"), "utf8")) as Workflow;

function needs(job: Job): string[] {
  return job.needs === undefined ? [] : [job.needs].flat();
}

function stepRunning(job: Job | undefined, command: string): Step | undefined {
  return job?.steps.find((step) => step.run?.trim() === command);
}

describe("GitHub Actions pins", () => {
  const files = readdirSync(workflows).filter((name) => /\.ya?ml$/.test(name));

  test("there are workflows to check", () => {
    expect(files).toContain("ci.yml");
  });

  for (const file of files) {
    test(`${file}: every uses: is pinned by a full commit SHA and names its release`, () => {
      const lines = readFileSync(join(workflows, file), "utf8")
        .split("\n")
        .filter((line) => /^\s*(-\s+)?uses:/.test(line));

      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toMatch(/uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d/);
      }
    });
  }
});

describe("ci.yml native libraries (S9)", () => {
  test("the workflow default stays contents: read", () => {
    expect(ci.permissions).toEqual({ contents: "read" });
  });

  test("native-libs builds with the same script, Docker and the signature check", () => {
    const job = ci.jobs["native-libs"];

    expect(
      stepRunning(job, "bun run native-libs:build --engine docker --verify-signature"),
    ).toBeDefined();
    expect(job?.permissions).toEqual({ contents: "read" });
  });

  test("native-libs uploads the whole .local/build/native/ folder as one artifact", () => {
    const upload = ci.jobs["native-libs"]?.steps.find((step) =>
      step.uses?.startsWith("actions/upload-artifact@"),
    );

    expect(upload?.with).toMatchObject({
      name: "native-libs",
      path: ".local/build/native/",
      "if-no-files-found": "error",
      // upload-artifact skips dot folders such as .local/ unless told otherwise.
      "include-hidden-files": true,
    });
    expect(Number(upload?.with?.["retention-days"])).toBeLessThanOrEqual(7);
  });

  test("only the attesting job can write attestations, and only on pushes to dev and main", () => {
    const writers = Object.entries(ci.jobs).filter(([, job]) =>
      Object.entries(job.permissions ?? {}).some(([, value]) => value === "write"),
    );

    expect(writers.map(([name]) => name)).toEqual(["attest-native-libs"]);
    const job = ci.jobs["attest-native-libs"];
    expect(job?.permissions).toEqual({
      contents: "read",
      "id-token": "write",
      attestations: "write",
    });
    expect(job?.if).toBe(
      "github.event_name == 'push' && (github.ref == 'refs/heads/dev' || github.ref == 'refs/heads/main')",
    );
    expect(needs(job as Job)).toEqual(["native-libs"]);
  });

  test("the attestation covers both libraries and the manifest", () => {
    const attest = ci.jobs["attest-native-libs"]?.steps.find((step) =>
      step.uses?.startsWith("actions/attest-build-provenance@"),
    );
    const subjects = String(attest?.with?.["subject-path"]).trim().split("\n");

    expect(subjects).toEqual([
      ".local/build/native/manifest.json",
      ".local/build/native/linux-x64/libsqlite3mc.so",
      ".local/build/native/win32-x64/sqlite3mc.dll",
    ]);
  });

  test("the check jobs test against the artifact, never skip, and build goop", () => {
    const job = ci.jobs.check as Job;
    const index = (step: Step | undefined) => job.steps.indexOf(step as Step);
    const download = job.steps.find((step) => step.uses?.startsWith("actions/download-artifact@"));
    const tests = stepRunning(job, "bun run test");
    const build = stepRunning(job, "bun run build");

    expect(needs(job)).toEqual(["native-libs"]);
    expect(download?.with).toEqual({ name: "native-libs", path: ".local/build/native/" });
    expect(tests?.env).toEqual({ GOOP_REQUIRE_NATIVE: "1" });
    expect(build).toBeDefined();
    expect(index(download)).toBeGreaterThanOrEqual(0);
    expect(index(download)).toBeLessThan(index(tests));
    expect(index(download)).toBeLessThan(index(build));
  });
});
