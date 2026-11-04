import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Bytes, newDataKey } from "@/shared/keys";
import {
  OsEnvelopeOpenError,
  OsEnvelopeSealError,
  OsEnvelopeUnavailableError,
  systemdCredsEnvelope,
} from "@/shared/keystore";

const repo = resolve(import.meta.dir, "..", "..", "..", "..", "..");
const CREDENTIAL = "Kh6pIfakeHostAndTpm2CredentialForTests==\n";
const OPEN_FAILED =
  "The OS key envelope could not be opened: it was changed, or it belongs to another user, machine or name.";
const TPM2_YES = "yes\\n+firmware\\n+driver\\n+system\\n+subsystem\\n+libraries\\n";

interface Behavior {
  version: string;
  tpm2: string;
  encrypt: string;
  decrypt: string;
}

// The fake logs every call's argv (separated by \x1f, one write per call, since the probes run
// at the same time) and environment, keeps the stdin of encrypt as its "vault", and opens only
// the credential it issued, like the real tool.
const DEFAULT: Behavior = {
  version: `printf 'systemd 262 (262.1-1-arch)\\n+PAM +AUDIT\\n'`,
  tpm2: `printf '${TPM2_YES}'`,
  encrypt: `cat > "$dir/vault"; printf '%s' '${CREDENTIAL}' > "$dir/issued"; cat "$dir/issued"`,
  decrypt: `cat > "$dir/received"
    if cmp -s "$dir/received" "$dir/issued"; then cat "$dir/vault"; else
      printf 'Failed to decrypt: io.systemd.System\\n' >&2; exit 1; fi`,
};

let fixture: string;
let bin: string;

beforeEach(() => {
  fixture = join(repo, ".temp", "tests", `systemd-creds-${crypto.randomUUID()}`);
  bin = join(fixture, "bin");
  mkdirSync(bin, { recursive: true });
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

function installFake(behavior: Partial<Behavior> = {}) {
  const { version, tpm2, encrypt, decrypt } = { ...DEFAULT, ...behavior };
  const script = `#!/bin/sh
dir='${fixture}'
line=call
for arg in "$@"; do line="$line$(printf '\\037')$arg"; done
printf '%s\\n' "$line" >> "$dir/argv.log"
export -p >> "$dir/env.log"
case " $* " in
  *" --version "*) ${version} ;;
  *" has-tpm2 "*) ${tpm2} ;;
  *" encrypt "*) ${encrypt} ;;
  *" decrypt "*) ${decrypt} ;;
esac
`;
  writeFileSync(join(bin, "systemd-creds"), script);
  chmodSync(join(bin, "systemd-creds"), 0o755);
}

const envelope = (platform = "linux") => systemdCredsEnvelope({ path: bin, platform });
const read = (name: string) =>
  existsSync(join(fixture, name)) ? readFileSync(join(fixture, name)) : Buffer.alloc(0);
const calls = () =>
  read("argv.log")
    .toString()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\x1f").slice(1));

/** The secret in every form a leak could take: raw bytes, hex and base64. */
function expectNowhere(secret: Bytes, ...files: string[]) {
  for (const file of files) {
    const content = read(file);
    expect(content.includes(Buffer.from(secret))).toBe(false);
    for (const encoding of ["hex", "base64"] as const) {
      expect(content.toString().includes(Buffer.from(secret).toString(encoding))).toBe(false);
    }
  }
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a rejection");
}

describe.skipIf(process.platform === "win32")("systemd-creds OS envelope", () => {
  test("seal sends the data key on stdin only and returns stdout as the sealed bytes", async () => {
    installFake();
    const dek = newDataKey();

    const sealed = await envelope().seal(dek);

    expect(Buffer.from(sealed).toString()).toBe(CREDENTIAL);
    expect(calls().filter((call) => call.includes("encrypt"))).toEqual([
      ["--user", "encrypt", "--with-key=host+tpm2", "--name=goop-dek", "-", "-"],
    ]);
    expect(new Uint8Array(read("vault"))).toEqual(dek);
    expectNowhere(dek, "argv.log", "env.log");
  });

  test("open sends the credential on stdin only and returns the data key from stdout", async () => {
    installFake();
    const dek = newDataKey();
    const sealed = await envelope().seal(dek);

    expect(await envelope().open(sealed)).toEqual(dek);
    expect(calls().at(-1)).toEqual(["--user", "decrypt", "--name=goop-dek", "-", "-"]);
    expect(read("received").toString()).toBe(CREDENTIAL);
    expectNowhere(dek, "argv.log", "env.log");
    expectNowhere(sealed, "argv.log", "env.log");
  });

  test("a tampered credential is refused with the one error, without the tool's output", async () => {
    installFake();
    const sealed = await envelope().seal(newDataKey());
    const tampered = new Uint8Array(sealed);
    tampered[3] = (tampered[3] ?? 0) ^ 0x01;

    const error = await rejection(envelope().open(tampered));

    expect(error).toBeInstanceOf(OsEnvelopeOpenError);
    expect(error.message).toBe(OPEN_FAILED);
  });

  test("a decrypted value that is not 32 bytes is refused with the one error", async () => {
    installFake({ decrypt: `cat > /dev/null; printf 'short'` });

    expect(await rejection(envelope().open(new TextEncoder().encode(CREDENTIAL)))).toBeInstanceOf(
      OsEnvelopeOpenError,
    );
  });

  test("oversized output is refused, and an oversized credential is never sent", async () => {
    installFake({
      encrypt: "cat > /dev/null; head -c 100000 /dev/zero",
      decrypt: "cat > /dev/null; head -c 100000 /dev/zero",
    });

    const sealError = await rejection(envelope().seal(newDataKey()));
    expect(sealError).toBeInstanceOf(OsEnvelopeSealError);
    expect(sealError.message).toBe(
      "The OS key store could not seal the data key: its output was larger than 4096 bytes.",
    );
    expect(await rejection(envelope().open(new TextEncoder().encode(CREDENTIAL)))).toBeInstanceOf(
      OsEnvelopeOpenError,
    );

    const before = calls().length;
    const huge = new Uint8Array(4097).fill(0x41);
    expect(await rejection(envelope().open(huge))).toBeInstanceOf(OsEnvelopeOpenError);
    expect(calls()).toHaveLength(before);
  });

  test("a failed seal on a usable machine names only the exit code", async () => {
    installFake({ encrypt: `cat > /dev/null; printf 'secret-ish detail\\n' >&2; exit 1` });

    const error = await rejection(envelope().seal(newDataKey()));

    expect(error).toBeInstanceOf(OsEnvelopeSealError);
    expect(error.message).toBe(
      "The OS key store could not seal the data key: systemd-creds exited with 1.",
    );
  });
});

describe.skipIf(process.platform === "win32")("systemd-creds availability", () => {
  test("systemd 262 with a TPM2 is available", async () => {
    installFake();

    expect(await envelope().availability()).toEqual({ available: true });
    expect(calls()).toContainEqual(["--version"]);
    expect(calls()).toContainEqual(["has-tpm2"]);
  });

  test("no systemd-creds on the PATH is a missing tool", async () => {
    expect(await envelope().availability()).toEqual({
      available: false,
      reason: "missing-tool",
      message: "systemd-creds was not found on the PATH.",
    });
  });

  test("another platform is unsupported, without looking for the tool", async () => {
    installFake();

    expect(await envelope("win32").availability()).toEqual({
      available: false,
      reason: "unsupported-platform",
      message: "systemd-creds needs Linux, and this system is win32.",
    });
    expect(calls()).toEqual([]);
  });

  test("systemd 255 is too old", async () => {
    installFake({ version: `printf 'systemd 255 (255.4-1ubuntu8)\\n'` });

    expect(await envelope().availability()).toMatchObject({
      available: false,
      reason: "old-version",
    });
  });

  test("no TPM2 is unavailable", async () => {
    installFake({ tpm2: `printf 'no\\n-firmware\\n-driver\\n'; exit 1` });

    expect(await envelope().availability()).toMatchObject({ available: false, reason: "no-tpm2" });
  });
});

describe.skipIf(process.platform === "win32")("an unavailable key store is not a lost key", () => {
  test("open without systemd-creds rejects as unavailable, not as a failed open", async () => {
    const error = await rejection(envelope().open(new TextEncoder().encode(CREDENTIAL)));

    expect(error).toBeInstanceOf(OsEnvelopeUnavailableError);
    expect((error as OsEnvelopeUnavailableError).reason).toBe("missing-tool");
    expect(error.message).toBe("systemd-creds was not found on the PATH.");
  });

  test("a failed open while the TPM2 is gone rejects as unavailable", async () => {
    installFake({ tpm2: `printf 'no\\n'; exit 1` });

    const error = await rejection(envelope().open(new TextEncoder().encode(CREDENTIAL)));

    expect(error).toBeInstanceOf(OsEnvelopeUnavailableError);
    expect((error as OsEnvelopeUnavailableError).reason).toBe("no-tpm2");
  });

  test("seal without a usable TPM2 rejects as unavailable and never encrypts", async () => {
    // systemd 257 without a TPM2 accepts `--with-key=host+tpm2` in user scope and seals with
    // the host key alone (Debian 13 sandbox), so only `has-tpm2` can refuse it.
    installFake({ tpm2: `printf 'partial\\n-firmware\\n'; exit 27` });

    const error = await rejection(envelope().seal(newDataKey()));

    expect(error).toBeInstanceOf(OsEnvelopeUnavailableError);
    expect((error as OsEnvelopeUnavailableError).reason).toBe("no-tpm2");
    expect(calls().filter((call) => call.includes("encrypt"))).toEqual([]);
    expect(existsSync(join(fixture, "vault"))).toBe(false);
  });

  test("a failed seal on systemd 255 rejects as unavailable", async () => {
    installFake({
      version: `printf 'systemd 255 (255.4-1ubuntu8)\\n'`,
      encrypt: `cat > /dev/null; printf "unrecognized option '--user'\\n" >&2; exit 1`,
    });

    const error = await rejection(envelope().seal(newDataKey()));

    expect(error).toBeInstanceOf(OsEnvelopeUnavailableError);
    expect((error as OsEnvelopeUnavailableError).reason).toBe("old-version");
  });
});
