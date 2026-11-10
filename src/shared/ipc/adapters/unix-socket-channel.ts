// The Linux channel (S5, S8): a Unix socket, `goop.sock`, in a runtime folder only this user can
// open. The folder is created 0700, or refused when it exists and another user owns it or can
// open it; it is never changed, since it may not be ours. The socket is 0600 as well, for a folder
// that is relaxed later. One daemon at a time: the daemon holds an exclusive lock on `goop.lock`
// while it listens, so a second one is refused before it touches the socket, and the kernel drops
// the lock when the daemon dies. A socket found with the lock free was left by a dead daemon.
import { dlopen, FFIType } from "bun:ffi";
import { closeSync, openSync } from "node:fs";
import { chmod, lstat, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { encodeFrame, frameReader } from "@/shared/ipc/model/framing";
import { parseMessage } from "@/shared/ipc/model/json-rpc";
import { ChannelError, runtimeFolderProblem, socketPath } from "@/shared/ipc/model/runtime-folder";
import type {
  Channel,
  ChannelConnection,
  ChannelEvents,
  ChannelListener,
} from "@/shared/ipc/types/channel";
import type { FrameReader } from "@/shared/ipc/types/framing";

const FOLDER_MODE = 0o700;
const SOCKET_MODE = 0o600;
const LOCK_MODE = 0o600;
const LOCK_EX = 2;
const LOCK_NB = 4;

const NOT_RUNNING = "goop daemon is not running";
const ALREADY_RUNNING = "goop daemon is already running";

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;

/** What each socket carries: its reader, its events and the bytes it still has to write. */
interface Link {
  reader: FrameReader;
  events?: ChannelEvents;
  unsent: Uint8Array[];
}

type LinkSocket = Bun.Socket<Link>;

const newLink = (): Link => ({ reader: frameReader(), unsent: [] });

/** Writes what the socket takes now and keeps the rest, in order, for `drain`. */
function flush(socket: LinkSocket) {
  const { unsent } = socket.data;
  while (unsent.length > 0) {
    const bytes = unsent[0] as Uint8Array;
    const written = Math.max(socket.write(bytes), 0);
    if (written < bytes.length) {
      unsent[0] = bytes.subarray(written);
      return;
    }
    unsent.shift();
  }
}

function connectionOf(socket: LinkSocket): ChannelConnection {
  return {
    send(message) {
      socket.data.unsent.push(encodeFrame(message));
      if (socket.data.unsent.length === 1) flush(socket);
    },
    close: () => socket.end(),
  };
}

const handlers: Bun.SocketHandler<Link> = {
  data(socket, chunk) {
    const { lines, tooLarge } = socket.data.reader.push(chunk);
    for (const line of lines) socket.data.events?.message(parseMessage(line));
    if (tooLarge) socket.end();
  },
  drain: flush,
  close(socket) {
    socket.data.unsent = [];
    socket.data.events?.close();
  },
};

/** Refuses a folder this user does not own alone; `create` makes it 0700 when it is missing. */
async function checkFolder(folder: string, create: boolean): Promise<"ready" | "missing"> {
  if (create) await mkdir(folder, { recursive: true, mode: FOLDER_MODE });
  let facts: Awaited<ReturnType<typeof lstat>>;
  try {
    facts = await lstat(folder);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return "missing";
    throw error;
  }
  const problem = runtimeFolderProblem(
    folder,
    { isDirectory: facts.isDirectory(), uid: facts.uid, mode: facts.mode },
    process.getuid?.() ?? -1,
  );
  if (problem) throw new ChannelError(problem);
  return "ready";
}

const loadLibc = () =>
  dlopen("libc.so.6", { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } });
let libc: ReturnType<typeof loadLibc> | undefined;

/** Takes the one-daemon lock in `folder` and returns its descriptor; closing it frees the lock. */
function lock(folder: string): number {
  const fd = openSync(join(folder, "goop.lock"), "a", LOCK_MODE);
  libc ??= loadLibc();
  if (libc.symbols.flock(fd, LOCK_EX | LOCK_NB) === 0) return fd;
  closeSync(fd);
  throw new ChannelError(ALREADY_RUNNING);
}

/** Whether a daemon answers at `path`. */
async function answers(path: string): Promise<boolean> {
  try {
    const socket = await Bun.connect({ unix: path, socket: { data() {} } });
    socket.end();
    return true;
  } catch {
    return false;
  }
}

/** Clears the way for a new socket at `path`, or refuses when a daemon is there. */
async function claim(path: string) {
  let facts: Awaited<ReturnType<typeof lstat>>;
  try {
    facts = await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  if (!facts.isSocket())
    throw new ChannelError(`Something that is not a socket is in the way: ${path}`);
  if (await answers(path)) throw new ChannelError(ALREADY_RUNNING);
  await rm(path, { force: true });
}

/** The channel in `folder`, for example `runtimeFolder(process.env)`. Linux only. */
export function unixSocketChannel(folder: string): Channel {
  const path = socketPath(folder);

  return {
    async listen(accept): Promise<ChannelListener> {
      await checkFolder(folder, true);
      let held: number | undefined = lock(folder);
      const unlock = () => {
        if (held !== undefined) closeSync(held);
        held = undefined;
      };
      try {
        await claim(path);
      } catch (error) {
        unlock();
        throw error;
      }
      let server: Bun.UnixSocketListener<Link>;
      try {
        server = Bun.listen<Link>({
          unix: path,
          socket: {
            ...handlers,
            open(socket) {
              socket.data = newLink();
              socket.data.events = accept(connectionOf(socket));
            },
          },
        });
      } catch (error) {
        unlock();
        // Another daemon bound the path between the check and here.
        if (errorCode(error) === "EADDRINUSE") throw new ChannelError(ALREADY_RUNNING);
        throw error;
      }
      try {
        await chmod(path, SOCKET_MODE);
      } catch (error) {
        server.stop(true);
        unlock();
        throw error;
      }
      return {
        async close() {
          if (held === undefined) return; // closed already: the socket may be the next daemon's
          server.stop(true);
          await rm(path, { force: true });
          unlock();
        },
      };
    },

    async connect(events): Promise<ChannelConnection> {
      if ((await checkFolder(folder, false)) === "missing") throw new ChannelError(NOT_RUNNING);
      let socket: LinkSocket;
      try {
        socket = await Bun.connect<Link>({
          unix: path,
          data: { ...newLink(), events },
          socket: handlers,
        });
      } catch (error) {
        if (["ENOENT", "ECONNREFUSED"].includes(errorCode(error) ?? "")) {
          throw new ChannelError(NOT_RUNNING);
        }
        throw error;
      }
      return connectionOf(socket);
    },
  };
}
