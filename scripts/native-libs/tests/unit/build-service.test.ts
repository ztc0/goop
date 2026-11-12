import { describe, expect, test } from "bun:test";
import { manifestText, withEntry } from "@scripts/native-libs/model/manifest";
import { buildLibrary } from "@scripts/native-libs/services/build";
import {
  ARCHIVE,
  bytes,
  COSIGN_BYTES,
  COSIGN_PIN,
  DLL,
  type Harness,
  harness,
  LIBRARY,
  RECIPE,
  RECIPE_WIN32,
  text,
} from "@scripts/native-libs/tests/fakes";
import { sha256Hex } from "@scripts/shared/download";

const OUT = "/repo/.local/build/native";
const NOTHING = "error: Nothing was written to .local/build/native/.";
const SHA = sha256Hex(LIBRARY);
const OFF = { verifySignature: false, cosign: COSIGN_PIN };
const ON = { verifySignature: true, cosign: COSIGN_PIN };
const SIGNATURE_OFF =
  "Signature: not checked (pass --verify-signature; it needs Rekor, the Sigstore transparency log).";
const OTHER = withEntry(undefined, "sqlite-vec", "linux-x64", {
  file: "vec0.so",
  sha256: "e".repeat(64),
});

async function failing(h: Harness, options = OFF, recipes = [RECIPE]) {
  const before = h.files.below(OUT).map((path) => [path, text(h.files.read(path))]);
  expect(await buildLibrary(h.deps, recipes, options)).toBe(1);
  expect(h.output.lines.at(-1)).toBe(NOTHING);
  expect(h.files.below(OUT).map((path) => [path, text(h.files.read(path))])).toEqual(before);
  return h.output.lines.filter((line) => line.startsWith("error: ")).slice(0, -1);
}

// build:native runs on Linux x86_64 only; these suites fake POSIX host paths and tools.
const describeOnLinuxHost = describe.skipIf(process.platform === "win32");

describeOnLinuxHost("buildLibrary", () => {
  test("checks the archive, builds in a fresh container, checks it and writes it", async () => {
    const h = harness();
    h.files.replace(`${OUT}/manifest.json`, bytes(manifestText(OTHER)));
    expect(await buildLibrary(h.deps, [RECIPE], OFF)).toBe(0);
    expect(h.output.lines).toEqual([
      "testlib linux-x64",
      SIGNATURE_OFF,
      "Downloading test-1.0.zip...",
      "sha256 ok: test-1.0.zip",
      "Building the image localhost/goop-native-libs-test:1 with podman...",
      "Compiling in a fresh podman container, without network...",
      "Toolchain ok: gcc 1",
      "Source ok: Test 1.2.3",
      `Output sha256 ok: ${SHA}  libtest.so`,
      "Wrote .local/build/native/linux-x64/libtest.so and .local/build/native/manifest.json in 2.5 s.",
    ]);
    expect(h.files.below(OUT)).toEqual([`${OUT}/linux-x64/libtest.so`, `${OUT}/manifest.json`]);
    expect(h.files.read(`${OUT}/linux-x64/libtest.so`)).toEqual(LIBRARY);
    const entry = { file: "libtest.so", sha256: SHA, sqliteVersion: "3.54.0" };
    expect(text(h.files.read(`${OUT}/manifest.json`))).toBe(
      manifestText(withEntry(OTHER, "testlib", "linux-x64", entry)),
    );
    expect(h.files.read("/repo/.temp/downloads/testlib-1/test-1.0.zip")).toEqual(ARCHIVE);
    expect(h.downloads).toEqual(["https://example.test/test-1.0.zip"]);
  });

  test("creates Podman's storage first, then builds the image and runs a fresh container", async () => {
    const h = harness();
    await buildLibrary(h.deps, [RECIPE], OFF);
    expect(h.files.directories.slice(0, 3)).toEqual(h.deps.engine.directories);
    const [build, run] = h.runner.engine();
    expect(build).toEqual([
      "build",
      "--tag",
      "localhost/goop-native-libs-test:1",
      "--file",
      "/repo/scripts/native-libs/testlib/Containerfile",
      "/repo/scripts/native-libs/testlib",
    ]);
    expect(run?.slice(0, 3)).toEqual(["run", "--rm", "--network=none"]);
    expect(run).toContain("/repo/.temp/downloads/testlib-1:/build/input:ro");
    expect(run).toContain("/repo/.temp/extract/testlib-2:/build/src");
    expect(run).toContain("/repo/.temp/tmp/testlib-3:/build/out");
    expect(h.runner.calls.every((call) => call.stream === true)).toBe(true);
  });

  test("a failed download stops before any container", async () => {
    const h = harness({}, { [RECIPE.archive.url]: undefined });
    expect(await failing(h)).toEqual(["error: Could not download test-1.0.zip: HTTP 404"]);
    expect(h.runner.calls).toEqual([]);
  });

  test("an archive with another sha256 is never stored, built or read", async () => {
    const h = harness({}, { [RECIPE.archive.url]: bytes("tampered") });
    expect(await failing(h)).toEqual([
      `error: sha256 mismatch for test-1.0.zip: expected ${RECIPE.archive.sha256}, got ${sha256Hex(bytes("tampered"))}`,
    ]);
    expect(h.runner.calls).toEqual([]);
    expect(h.files.files.size).toBe(0);
  });

  test("a failed image build or container run writes nothing", async () => {
    const build = harness({ build: { exitCode: 125 } });
    expect(await failing(build)).toEqual([
      "error: Could not build the image (podman build exited 125).",
    ]);
    expect(build.runner.engine()).toHaveLength(1);
    const run = harness({ run: { exitCode: 2 } });
    expect(await failing(run)).toEqual([
      "error: The build container failed (podman run exited 2).",
    ]);
  });

  test("another toolchain or source version writes nothing", async () => {
    expect(await failing(harness({ toolchain: "gcc 2\n" }))).toEqual([
      "error: The build image has another toolchain: gcc is 2, expected 1",
    ]);
    expect(await failing(harness({ source: '#define VERSION "1.2.4"\n' }))).toEqual([
      "error: test.c declares Test 1.2.4, expected 1.2.3.",
    ]);
    expect(await failing(harness({ source: "no version\n" }))).toEqual([
      "error: test.c declares Test no version, expected 1.2.3.",
    ]);
  });

  test("an output that differs from its pin writes nothing, even over an old manifest", async () => {
    const h = harness({ library: bytes("other ELF") });
    h.files.replace(`${OUT}/manifest.json`, bytes(manifestText(OTHER)));
    expect(await failing(h)).toEqual([
      `error: The built libtest.so does not match its pin: expected ${SHA}, got ${sha256Hex(bytes("other ELF"))}.`,
    ]);
  });

  test("a manifest that cannot be written puts the old library back", async () => {
    const h = harness();
    const target = `${OUT}/${RECIPE.platform}/${RECIPE.output.file}`;
    h.files.replace(target, bytes("old ELF"));
    h.files.replace(`${OUT}/manifest.json`, bytes(manifestText(OTHER)));
    h.files.failReplace.add(`${OUT}/manifest.json`);
    expect(await failing(h)).toEqual([
      `error: Could not write .local/build/native/manifest.json (Error: cannot write ${OUT}/manifest.json).`,
    ]);
  });

  test("a manifest that cannot be written removes a library that was not there before", async () => {
    const h = harness();
    h.files.failReplace.add(`${OUT}/manifest.json`);
    expect(await failing(h)).toHaveLength(1);
    expect(h.files.below(OUT)).toEqual([]);
  });

  test("a library that cannot be written leaves everything as it was", async () => {
    const h = harness();
    const target = `${OUT}/${RECIPE.platform}/${RECIPE.output.file}`;
    h.files.replace(`${OUT}/manifest.json`, bytes(manifestText(OTHER)));
    h.files.failReplace.add(target);
    expect(await failing(h)).toEqual([
      `error: Could not write .local/build/native/${RECIPE.platform}/${RECIPE.output.file} (Error: cannot write ${target}).`,
    ]);
  });

  test("an invalid existing manifest is refused, not overwritten", async () => {
    const h = harness();
    h.files.replace(`${OUT}/manifest.json`, bytes('{"version":2}'));
    expect(await failing(h)).toEqual([
      "error: The existing .local/build/native/manifest.json cannot be read (manifest.json version must be 1); fix or remove it.",
    ]);
  });
});

describeOnLinuxHost("buildLibrary with several targets", () => {
  const BOTH = [RECIPE, RECIPE_WIN32];
  const SO = `${OUT}/linux-x64/libtest.so`;
  const DLL_PATH = `${OUT}/win32-x64/test.dll`;
  const entry = (file: string, content: Uint8Array) => ({
    file,
    sha256: sha256Hex(content),
    sqliteVersion: "3.54.0",
  });
  /** A manifest and both libraries from an earlier build. */
  const published = (h: Harness) => {
    h.files.replace(SO, bytes("old ELF"));
    h.files.replace(DLL_PATH, bytes("old PE"));
    const old = withEntry(
      withEntry(OTHER, "testlib", "linux-x64", entry("libtest.so", bytes("old ELF"))),
      "testlib",
      "win32-x64",
      entry("test.dll", bytes("old PE")),
    );
    h.files.replace(`${OUT}/manifest.json`, bytes(manifestText(old)));
  };

  test("builds each target in its own image, then writes both libraries and one manifest", async () => {
    const h = harness();
    h.files.replace(`${OUT}/manifest.json`, bytes(manifestText(OTHER)));
    expect(await buildLibrary(h.deps, BOTH, OFF)).toBe(0);
    expect(h.output.lines.filter((line) => line.startsWith("testlib "))).toEqual([
      "testlib linux-x64",
      "testlib win32-x64",
    ]);
    expect(h.output.lines.filter((line) => line.startsWith("Output sha256 ok"))).toEqual([
      `Output sha256 ok: ${SHA}  libtest.so`,
      `Output sha256 ok: ${sha256Hex(DLL)}  test.dll`,
    ]);
    expect(h.output.lines.at(-1)).toBe(
      "Wrote .local/build/native/linux-x64/libtest.so, .local/build/native/win32-x64/test.dll and .local/build/native/manifest.json in 2.5 s.",
    );
    expect(h.runner.engine().map((args) => args.at(-4))).toEqual([
      "localhost/goop-native-libs-test:1",
      "localhost/goop-native-libs-test:1",
      "localhost/goop-native-libs-test-win32:1",
      "localhost/goop-native-libs-test-win32:1",
    ]);
    expect(h.files.below(OUT)).toEqual([SO, `${OUT}/manifest.json`, DLL_PATH]);
    expect(h.files.read(DLL_PATH)).toEqual(DLL);
    expect(text(h.files.read(`${OUT}/manifest.json`))).toBe(
      manifestText(
        withEntry(
          withEntry(OTHER, "testlib", "linux-x64", entry("libtest.so", LIBRARY)),
          "testlib",
          "win32-x64",
          entry("test.dll", DLL),
        ),
      ),
    );
  });

  test("one target keeps the other platform's library and manifest entry", async () => {
    const h = harness();
    published(h);
    expect(await buildLibrary(h.deps, [RECIPE_WIN32], OFF)).toBe(0);
    expect(h.files.read(SO)).toEqual(bytes("old ELF"));
    expect(text(h.files.read(`${OUT}/manifest.json`))).toContain(
      `"sha256": "${sha256Hex(bytes("old ELF"))}"`,
    );
    expect(text(h.files.read(`${OUT}/manifest.json`))).toContain(`"sha256": "${sha256Hex(DLL)}"`);
  });

  test("a failure in the second target writes nothing, not even the first target", async () => {
    const run = harness({ images: { [RECIPE_WIN32.image]: { run: { exitCode: 2 } } } });
    published(run);
    expect(await failing(run, OFF, BOTH)).toEqual([
      "error: The build container failed (podman run exited 2).",
    ]);
    expect(run.output.lines).toContain(`Output sha256 ok: ${SHA}  libtest.so`);
    const pin = harness({ images: { [RECIPE_WIN32.image]: { library: bytes("other PE") } } });
    published(pin);
    expect(await failing(pin, OFF, BOTH)).toEqual([
      `error: The built test.dll does not match its pin: expected ${sha256Hex(DLL)}, got ${sha256Hex(bytes("other PE"))}.`,
    ]);
  });

  test("a second library that cannot be written puts the first one back", async () => {
    const h = harness();
    published(h);
    h.files.failReplace.add(DLL_PATH);
    expect(await failing(h, OFF, BOTH)).toEqual([
      `error: Could not write .local/build/native/win32-x64/test.dll (Error: cannot write ${DLL_PATH}).`,
    ]);
  });

  test("a manifest that cannot be written puts both libraries back or removes them", async () => {
    const old = harness();
    published(old);
    old.files.failReplace.add(`${OUT}/manifest.json`);
    expect(await failing(old, OFF, BOTH)).toHaveLength(1);
    const fresh = harness();
    fresh.files.failReplace.add(`${OUT}/manifest.json`);
    expect(await failing(fresh, OFF, BOTH)).toHaveLength(1);
    expect(fresh.files.below(OUT)).toEqual([]);
  });
});

describeOnLinuxHost("buildLibrary with --verify-signature", () => {
  const SIGNED = [
    "testlib linux-x64",
    "Downloading cosign v0.0.1...",
    "sha256 ok: cosign-test",
    "Downloading SUMS, SUMS.sig and SUMS.pem...",
    "Verifying the Cosign signature of SUMS (identity https://example.test/wf.yml@refs/heads/main, issuer https://issuer.test)...",
  ];

  test("checks the signature with the pinned cosign before the archive", async () => {
    const h = harness();
    expect(await buildLibrary(h.deps, [RECIPE], ON)).toBe(0);
    expect(h.output.lines.slice(0, 7)).toEqual([
      ...SIGNED,
      "Signature ok: SUMS lists test-1.0.zip with its pinned sha256.",
      "Downloading test-1.0.zip...",
    ]);
    expect(h.downloads).toEqual([
      COSIGN_PIN.url,
      RECIPE.signed.list.url,
      RECIPE.signed.signature.url,
      RECIPE.signed.certificate.url,
      RECIPE.archive.url,
    ]);
    const dir = "/repo/.temp/downloads/cosign-1";
    expect(h.files.files.get(`${dir}/cosign`)).toEqual({ content: COSIGN_BYTES, mode: 0o700 });
    expect(h.runner.calls[0]).toEqual({
      command: [
        `${dir}/cosign`,
        "verify-blob",
        "--certificate",
        `${dir}/SUMS.pem`,
        "--signature",
        `${dir}/SUMS.sig`,
        "--certificate-identity",
        "https://example.test/wf.yml@refs/heads/main",
        "--certificate-oidc-issuer",
        "https://issuer.test",
        `${dir}/SUMS`,
      ],
      env: { TUF_ROOT: `${dir}/tuf` },
      stream: true,
    });
  });

  test("a cosign with another sha256 is never stored or run", async () => {
    const h = harness({}, { [COSIGN_PIN.url]: bytes("evil") });
    expect(await failing(h, ON)).toEqual([
      `error: sha256 mismatch for cosign-test: expected ${COSIGN_PIN.sha256}, got ${sha256Hex(bytes("evil"))}`,
    ]);
    expect(h.runner.calls).toEqual([]);
    expect(h.files.files.size).toBe(0);
  });

  test("a failed download of the signed files stops before cosign runs", async () => {
    const h = harness({}, { [RECIPE.signed.signature.url]: undefined });
    expect(await failing(h, ON)).toEqual(["error: Could not download SUMS.sig: HTTP 404"]);
    expect(h.runner.calls).toEqual([]);
  });

  test("fails closed when cosign cannot verify, as without Rekor; the archive is not fetched", async () => {
    const h = harness({ cosign: { exitCode: 1 } });
    expect(await failing(h, ON)).toEqual([
      "error: Cosign could not verify SUMS (exit 1). It needs Rekor, the Sigstore transparency log; without that check nothing is trusted.",
    ]);
    expect(h.output.lines.slice(0, 5)).toEqual(SIGNED);
    expect(h.downloads).not.toContain(RECIPE.archive.url);
    expect(h.runner.engine()).toEqual([]);
  });

  test("a signed list that gives the archive another sha256 is refused", async () => {
    const other = bytes(`${"0".repeat(64)}  test-1.0.zip\n`);
    expect(await failing(harness({}, { [RECIPE.signed.list.url]: other }), ON)).toEqual([
      `error: SUMS gives test-1.0.zip the sha256 ${"0".repeat(64)}, not its pin ${RECIPE.archive.sha256}.`,
    ]);
    expect(await failing(harness({}, { [RECIPE.signed.list.url]: bytes("\n") }), ON)).toEqual([
      "error: SUMS does not list test-1.0.zip.",
    ]);
  });
});
