// Where the Linux channel lives and whether that place can be trusted (S5). Pure: the adapter
// reads the environment and the folder and hands the facts here.
// Unix socket paths always use `/`, whatever system runs the code (and the tests).
import { isAbsolute, join } from "node:path/posix";
import type { FolderFacts } from "@/shared/ipc/types/runtime-folder";

export const SOCKET_FILE = "goop.sock";
/** `sun_path` holds 108 bytes, the last one the terminating NUL. */
export const MAX_SOCKET_PATH_BYTES = 107;

/** The channel cannot be set up; the message names the reason and the path, never a payload. */
export class ChannelError extends Error {
  override name = "ChannelError";
}

/** `GOOP_RUNTIME_DIR`, else `goop/` inside `XDG_RUNTIME_DIR`. */
export function runtimeFolder(env: Readonly<Record<string, string | undefined>>): string {
  for (const [name, inside] of [
    ["GOOP_RUNTIME_DIR", ""],
    ["XDG_RUNTIME_DIR", "goop"],
  ] as const) {
    const value = env[name];
    if (!value) continue;
    if (!isAbsolute(value)) throw new ChannelError(`${name} must be an absolute path: ${value}`);
    return join(value, inside);
  }
  throw new ChannelError("No runtime folder: set GOOP_RUNTIME_DIR or XDG_RUNTIME_DIR");
}

/** The socket inside `folder`; refuses a path the system cannot bind. */
export function socketPath(folder: string): string {
  const path = join(folder, SOCKET_FILE);
  const bytes = new TextEncoder().encode(path).length;
  if (bytes > MAX_SOCKET_PATH_BYTES) {
    throw new ChannelError(
      `The socket path is ${bytes} bytes, over the limit of ${MAX_SOCKET_PATH_BYTES}: ${path}`,
    );
  }
  return path;
}

/** Why `folder` cannot hold the socket, or undefined when only `uid` can reach it. */
export function runtimeFolderProblem(
  folder: string,
  facts: FolderFacts,
  uid: number,
): string | undefined {
  if (!facts.isDirectory) return `The runtime folder is not a folder: ${folder}`;
  if (facts.uid !== uid) return `The runtime folder belongs to another user: ${folder}`;
  if ((facts.mode & 0o077) !== 0) {
    const shown = (facts.mode & 0o7777).toString(8).padStart(4, "0");
    return `The runtime folder is open to other users (mode ${shown}, it must be 0700): ${folder}`;
  }
  return undefined;
}
