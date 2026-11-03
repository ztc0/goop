// The Linux OS envelope (S5): `systemd-creds --user` seals the data key with the host key and the
// TPM2, for this user only. The data key and the credential travel only through stdin and stdout:
// never argv (any local user can read it with `ps`), a file or the environment. stderr is never
// read, so no tool message can leak into an error.
import {
  OsEnvelopeOpenError,
  OsEnvelopeSealError,
  OsEnvelopeUnavailableError,
} from "../model/os-key-envelope";
import { credsArgs, systemdAvailability } from "../model/systemd-creds";
import type { Bytes, DataKey } from "../types/key-envelope";
import type {
  OsEnvelopeAvailability,
  OsEnvelopeUnavailable,
  OsKeyEnvelope,
} from "../types/os-key-envelope";

/** A sealed 32-byte key is about 770 bytes of base64 (T11 spike); more is refused. */
const SEALED_LIMIT = 4096;
const PROBE_LIMIT = 4096;
const DEK_BYTES = 32;

export interface SystemdCredsOptions {
  /** The PATH searched for `systemd-creds`. Tests point it at a fake. */
  path?: string;
  platform?: string;
}

interface Run {
  exitCode: number;
  /** Undefined when the output passed the limit and the process was killed. */
  output: Bytes | undefined;
}

/**
 * Reads at most `limit` bytes into one new buffer, or undefined past the limit. Every chunk read
 * is zeroed: on `open` they hold the data key.
 */
async function readBounded(stream: ReadableStream<Uint8Array>, limit: number) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      chunks.push(chunk);
      size += chunk.length;
      if (size > limit) return undefined;
    }
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}

/** Runs the tool from an argv array, with no shell. `input` goes to stdin only. */
async function run(executable: string, args: string[], input: Bytes | null, limit: number) {
  const child = Bun.spawn([executable, ...args], {
    stdin: input ?? "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await readBounded(child.stdout, limit);
  if (output === undefined) child.kill();
  return { exitCode: await child.exited, output } satisfies Run;
}

export function systemdCredsEnvelope(options: SystemdCredsOptions = {}): OsKeyEnvelope {
  const platform = options.platform ?? process.platform;
  const path = options.path ?? process.env.PATH ?? "";

  function locate(): string | OsEnvelopeUnavailable {
    if (platform !== "linux") {
      return {
        available: false,
        reason: "unsupported-platform",
        message: `systemd-creds needs Linux, and this system is ${platform}.`,
      };
    }
    return (
      Bun.which("systemd-creds", { PATH: path }) ?? {
        available: false,
        reason: "missing-tool",
        message: "systemd-creds was not found on the PATH.",
      }
    );
  }

  function executable(): string {
    const found = locate();
    if (typeof found !== "string") throw new OsEnvelopeUnavailableError(found);
    return found;
  }

  async function availability(): Promise<OsEnvelopeAvailability> {
    const found = locate();
    if (typeof found !== "string") return found;
    const [version, tpm2] = await Promise.all([
      run(found, ["--version"], null, PROBE_LIMIT),
      run(found, ["has-tpm2"], null, PROBE_LIMIT),
    ]);
    const text = (result: Run) => new TextDecoder().decode(result.output ?? new Uint8Array());
    return systemdAvailability(text(version), text(tpm2), tpm2.exitCode);
  }

  /** After a failed run: an unavailable key store wins over the error the run would give. */
  async function failure(error: Error): Promise<Error> {
    const state = await availability();
    return state.available ? error : new OsEnvelopeUnavailableError(state);
  }

  return {
    availability,

    async seal(dek: DataKey): Promise<Bytes> {
      // Without a usable TPM2, `--with-key=host+tpm2` can still succeed with the host key alone.
      const state = await availability();
      if (!state.available) throw new OsEnvelopeUnavailableError(state);
      const { exitCode, output } = await run(executable(), credsArgs("encrypt"), dek, SEALED_LIMIT);
      if (output === undefined) {
        throw new OsEnvelopeSealError(`its output was larger than ${SEALED_LIMIT} bytes`);
      }
      if (exitCode !== 0) {
        throw await failure(new OsEnvelopeSealError(`systemd-creds exited with ${exitCode}`));
      }
      if (output.length === 0) throw new OsEnvelopeSealError("its output was empty");
      return output;
    },

    async open(sealed: Bytes): Promise<DataKey> {
      if (sealed.length === 0 || sealed.length > SEALED_LIMIT) throw new OsEnvelopeOpenError();
      const { exitCode, output } = await run(executable(), credsArgs("decrypt"), sealed, DEK_BYTES);
      if (output !== undefined && exitCode === 0 && output.length === DEK_BYTES) return output;
      output?.fill(0);
      throw exitCode === 0 ? new OsEnvelopeOpenError() : await failure(new OsEnvelopeOpenError());
    },
  };
}
