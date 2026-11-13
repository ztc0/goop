// INSECURE, DEVELOPMENT ONLY (dev-sandbox S8). A fake OS key store for `bun run dev`: it seals the
// data key with a random key kept in plain text in `<folder>/INSECURE-DEV-KEY`, so anyone who can
// read that file can open the vault. It exists so a source run inside the repo unlocks by itself,
// the way the real TPM2 or DPAPI does, without touching the system (goop S25). The daemon picks it
// only from source with GOOP_HOME in the repo's `.local/`; the compiled goop refuses it here too.
// No new crypto: the key is a recovery key, and the seal is the recovery envelope (HKDF-SHA256,
// AES-256-GCM).
import { randomUUID } from "node:crypto";
import { chmod, link, mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type Bytes,
  type DataKey,
  EnvelopeFormatError,
  EnvelopeOpenError,
  KeyInputError,
  newRecoveryKey,
  openRecoveryEnvelope,
  sealWithRecoveryKey,
} from "@/shared/vault/keys";
import {
  OsEnvelopeOpenError,
  OsEnvelopeSealError,
} from "@/shared/vault/keystore/model/os-key-envelope";
import type { OsKeyEnvelope } from "@/shared/vault/keystore/types/os-key-envelope";

export const INSECURE_DEV_KEY_FILE = "INSECURE-DEV-KEY";

const FOLDER_MODE = 0o700;
const FILE_MODE = 0o600;
/** A recovery key is 39 characters; anything far larger is not one. */
const KEY_LIMIT = 1024;

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;

/** The compiled goop never uses the development key, whatever its environment says. */
export class InsecureDevKeyRefusedError extends Error {
  override name = "InsecureDevKeyRefusedError";
  constructor() {
    super("The compiled goop never uses the insecure development key.");
  }
}

export interface InsecureDevKeyOptions {
  /** Whether this is the compiled executable; `Bun.isStandaloneExecutable` by default. */
  standalone?: boolean;
  platform?: string;
}

/** A failed seal or open of the key itself: it never says which byte or key was wrong. */
const isKeyProblem = (error: unknown) =>
  error instanceof EnvelopeOpenError ||
  error instanceof EnvelopeFormatError ||
  error instanceof KeyInputError;

export function insecureDevKeyEnvelope(
  folder: string,
  options: InsecureDevKeyOptions = {},
): OsKeyEnvelope {
  if (options.standalone ?? Bun.isStandaloneExecutable) throw new InsecureDevKeyRefusedError();
  const platform = options.platform ?? process.platform;
  const file = join(folder, INSECURE_DEV_KEY_FILE);

  /** The key on disk, or undefined when there is none yet. */
  async function readKey(): Promise<string | undefined> {
    try {
      if ((await stat(file)).size > KEY_LIMIT) return "";
      return await readFile(file, "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined;
      throw error;
    }
  }

  /**
   * Writes a new key whole (a 0600 temporary file, then hard-linked), never over an existing one:
   * when two seals race, the first link wins and both use its key.
   */
  async function createKey(): Promise<string> {
    await mkdir(folder, { recursive: true, mode: FOLDER_MODE });
    // mkdir leaves an existing folder as it is and applies the umask to a new one.
    if (platform !== "win32") await chmod(folder, FOLDER_MODE);
    const temp = join(folder, `.${INSECURE_DEV_KEY_FILE}.${randomUUID()}.part`);
    try {
      const handle = await open(temp, "wx", FILE_MODE);
      try {
        await handle.writeFile(newRecoveryKey());
        await handle.sync();
      } finally {
        await handle.close();
      }
      await link(temp, file).catch((error: unknown) => {
        if (errorCode(error) !== "EEXIST") throw error;
      });
    } finally {
      await rm(temp, { force: true });
    }
    return (await readKey()) ?? "";
  }

  return {
    availability: async () => ({ available: true }),

    async seal(dek: DataKey): Promise<Bytes> {
      const key = (await readKey()) ?? (await createKey());
      try {
        return await sealWithRecoveryKey(dek, key);
      } catch (error) {
        if (!isKeyProblem(error)) throw error;
        throw new OsEnvelopeSealError(`${INSECURE_DEV_KEY_FILE} does not hold a development key`);
      }
    },

    async open(sealed: Bytes): Promise<DataKey> {
      // A missing key is a lost key: only the recovery key helps, never a new one.
      const key = await readKey();
      if (key === undefined) throw new OsEnvelopeOpenError();
      try {
        return await openRecoveryEnvelope(sealed, key);
      } catch (error) {
        if (isKeyProblem(error)) throw new OsEnvelopeOpenError();
        throw error;
      }
    },
  };
}
