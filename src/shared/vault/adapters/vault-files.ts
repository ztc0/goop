// The vault folder on disk (S9). Every file is written whole or not at all: a 0600 temporary
// file in the folder, flushed, then renamed over the target, or hard-linked to it when an existing
// file must be kept (a link never replaces, so the check and the write are one step).
import { randomUUID } from "node:crypto";
import { chmod, link, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Bytes } from "@/shared/vault/keys";
import { VaultFileError } from "../model/vault-state";
import type { VaultFiles } from "../types/vault";

const FOLDER_MODE = 0o700;
const FILE_MODE = 0o600;
/** Envelopes are under 4 KiB; anything far larger is not one. */
const READ_LIMIT = 64 * 1024;

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;

/** The vault files in `folder`, for example `<GOOP_HOME>/data/`. Windows has no file modes. */
export function nodeVaultFiles(folder: string, platform: string = process.platform): VaultFiles {
  return {
    path: (name) => join(folder, name),

    async exists(name) {
      try {
        await stat(join(folder, name));
        return true;
      } catch (error) {
        if (errorCode(error) === "ENOENT") return false;
        throw error;
      }
    },

    async read(name): Promise<Bytes | undefined> {
      const path = join(folder, name);
      try {
        if ((await stat(path)).size > READ_LIMIT) throw new VaultFileError(name, "is too large");
        return new Uint8Array(await readFile(path));
      } catch (error) {
        if (errorCode(error) === "ENOENT") return undefined;
        throw error;
      }
    },

    async write(name, bytes, { replace }) {
      await mkdir(folder, { recursive: true, mode: FOLDER_MODE });
      // mkdir leaves an existing folder as it is and applies the umask to a new one.
      if (platform !== "win32") await chmod(folder, FOLDER_MODE);
      const target = join(folder, name);
      const temp = join(folder, `.${name}.${randomUUID()}.part`);
      try {
        const handle = await open(temp, "wx", FILE_MODE);
        try {
          await handle.writeFile(bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (replace) {
          await rename(temp, target);
          return;
        }
        try {
          await link(temp, target);
        } catch (error) {
          if (errorCode(error) === "EEXIST") throw new VaultFileError(name, "already exists");
          throw error;
        }
      } finally {
        await rm(temp, { force: true });
      }
    },

    remove: (name) => rm(join(folder, name), { force: true }),
  };
}
