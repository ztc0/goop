import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  ChannelError,
  type ChannelEvents,
  type ChannelListener,
  JSON_RPC_ERRORS,
  MAX_MESSAGE_BYTES,
  MAX_SOCKET_PATH_BYTES,
  type ParsedMessage,
  unixSocketChannel,
} from "@/shared/ipc";

const repo = resolve(import.meta.dir, "..", "..", "..", "..", "..");
const created: string[] = [];
const listeners: ChannelListener[] = [];

afterEach(async () => {
  for (const listener of listeners.splice(0)) await listener.close();
  for (const folder of created.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A fresh folder under `.temp/tests/`, removed after the test; the runtime folder goes inside. */
function scratch(): string {
  const folder = join(repo, ".temp", "tests", `ipc-${crypto.randomUUID().slice(0, 8)}`);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  created.push(folder);
  return folder;
}

const mode = (path: string) => lstatSync(path).mode & 0o777;

async function until(done: () => boolean, what: string) {
  for (let wait = 0; wait < 200; wait++) {
    if (done()) return;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Records what arrives on one end. */
function recorder() {
  const messages: ParsedMessage[] = [];
  const state = { closed: false };
  const events: ChannelEvents = {
    message: (message) => messages.push(message),
    close: () => {
      state.closed = true;
    },
  };
  return {
    events,
    messages,
    state,
    received: (count: number) => until(() => messages.length >= count, `${count} messages`),
    closed: () => until(() => state.closed, "the close"),
  };
}

/** A daemon that answers every request with its params and records everything. */
async function echoDaemon(folder: string) {
  const server = recorder();
  const listener = await unixSocketChannel(folder).listen((connection) => ({
    message(message) {
      server.events.message(message);
      if (message.ok && "method" in message.message && "id" in message.message) {
        connection.send({
          jsonrpc: "2.0",
          id: message.message.id,
          result: message.message.params ?? null,
        });
      } else if (!message.ok) {
        connection.send({ jsonrpc: "2.0", id: null, error: message.error });
      }
    },
    close: server.events.close,
  }));
  listeners.push(listener);
  return { server, listener };
}

/** A client that writes raw bytes, for what the channel's own `send` never writes. */
async function rawClient(path: string) {
  const received: string[] = [];
  const state = { closed: false };
  const socket = await Bun.connect({
    unix: path,
    socket: {
      data: (_, data) => {
        received.push(new TextDecoder().decode(data));
      },
      close: () => {
        state.closed = true;
      },
    },
  });
  return { socket, received, state };
}

describe.skipIf(process.platform === "win32")("unixSocketChannel (S2, S4, S5, S8)", () => {
  test("a request gets its response", async () => {
    const folder = join(scratch(), "run");
    const { server } = await echoDaemon(folder);
    const client = recorder();
    const connection = await unixSocketChannel(folder).connect(client.events);

    connection.send({ jsonrpc: "2.0", id: 1, method: "offers.get", params: { id: "o-ñ" } });

    await client.received(1);
    expect(client.messages).toEqual([
      { ok: true, message: { jsonrpc: "2.0", id: 1, result: { id: "o-ñ" } } },
    ]);
    expect(server.messages).toEqual([
      {
        ok: true,
        message: { jsonrpc: "2.0", id: 1, method: "offers.get", params: { id: "o-ñ" } },
      },
    ]);
    connection.close();
    await client.closed();
    await server.closed();
  });

  test("a notification arrives and gets no response", async () => {
    const folder = join(scratch(), "run");
    const { server } = await echoDaemon(folder);
    const client = recorder();
    const connection = await unixSocketChannel(folder).connect(client.events);

    connection.send({ jsonrpc: "2.0", method: "search.progress", params: [0.5] });
    connection.send({ jsonrpc: "2.0", id: 2, method: "ping" });

    await client.received(1);
    expect(server.messages).toEqual([
      { ok: true, message: { jsonrpc: "2.0", method: "search.progress", params: [0.5] } },
      { ok: true, message: { jsonrpc: "2.0", id: 2, method: "ping" } },
    ]);
    expect(client.messages).toEqual([
      { ok: true, message: { jsonrpc: "2.0", id: 2, result: null } },
    ]);
  });

  test("a message near MAX_MESSAGE_BYTES travels whole both ways", async () => {
    const folder = join(scratch(), "run");
    await echoDaemon(folder);
    const client = recorder();
    const connection = await unixSocketChannel(folder).connect(client.events);
    const fill = "ñ".repeat((MAX_MESSAGE_BYTES - 100) / 2);

    connection.send({ jsonrpc: "2.0", id: 3, method: "m", params: [fill] });

    await client.received(1);
    expect(client.messages).toEqual([
      { ok: true, message: { jsonrpc: "2.0", id: 3, result: [fill] } },
    ]);
  });

  test("two messages in one chunk and one message split across chunks", async () => {
    const folder = join(scratch(), "run");
    const { server } = await echoDaemon(folder);
    const raw = await rawClient(join(folder, "goop.sock"));
    const one = { jsonrpc: "2.0", method: "a" } as const;
    const two = { jsonrpc: "2.0", method: "b", params: ["ñ"] } as const;
    const split = new TextEncoder().encode(`${JSON.stringify(two)}\n`);
    const cut = split.indexOf(0xc3) + 1; // inside "ñ"

    raw.socket.write(`${JSON.stringify(one)}\n${JSON.stringify(two)}\n`);
    await server.received(2);
    raw.socket.write(split.subarray(0, cut));
    await Bun.sleep(30);
    expect(server.messages).toHaveLength(2);
    raw.socket.write(split.subarray(cut));

    await server.received(3);
    expect(server.messages).toEqual([
      { ok: true, message: one },
      { ok: true, message: two },
      { ok: true, message: two },
    ]);
    raw.socket.end();
  });

  test("an invalid message arrives as the error to answer with, and the connection stays open", async () => {
    const folder = join(scratch(), "run");
    const { server } = await echoDaemon(folder);
    const raw = await rawClient(join(folder, "goop.sock"));
    const secret = "correct horse battery staple";

    raw.socket.write(`{"passphrase":"${secret}"\n`);
    raw.socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "m", secret })}\n`);
    raw.socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "m" })}\n`);

    await server.received(3);
    expect(server.messages).toEqual([
      { ok: false, error: JSON_RPC_ERRORS.parseError },
      { ok: false, error: JSON_RPC_ERRORS.invalidRequest },
      { ok: true, message: { jsonrpc: "2.0", id: 2, method: "m" } },
    ]);
    await until(() => raw.received.join("").split("\n").length > 3, "three answers");
    expect(raw.received.join("")).toBe(
      [
        JSON.stringify({ jsonrpc: "2.0", id: null, error: JSON_RPC_ERRORS.parseError }),
        JSON.stringify({ jsonrpc: "2.0", id: null, error: JSON_RPC_ERRORS.invalidRequest }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, result: null }),
        "",
      ].join("\n"),
    );
    expect(raw.received.join("")).not.toContain(secret);
    expect(raw.state.closed).toBe(false);
    raw.socket.end();
  });

  test("a frame over MAX_MESSAGE_BYTES closes the connection", async () => {
    const folder = join(scratch(), "run");
    const { server } = await echoDaemon(folder);
    const raw = await rawClient(join(folder, "goop.sock"));
    const chunk = new Uint8Array(64 * 1024).fill(0x61);

    for (let sent = 0; sent <= MAX_MESSAGE_BYTES && !raw.state.closed; ) {
      sent += Math.max(raw.socket.write(chunk), 0);
      await Bun.sleep(1);
    }

    await until(() => raw.state.closed, "the close");
    await server.closed();
    expect(server.messages).toEqual([]);
    expect(raw.received).toEqual([]);
  });

  test("the folder is 0700 and the socket 0600", async () => {
    const parent = scratch();
    const folder = join(parent, "nested", "run");
    await echoDaemon(folder);

    expect(mode(folder)).toBe(0o700);
    expect(lstatSync(join(folder, "goop.sock")).isSocket()).toBe(true);
    expect(mode(join(folder, "goop.sock"))).toBe(0o600);
  });

  test("an existing folder others can open is refused and left as it is", async () => {
    const folder = join(scratch(), "run");
    mkdirSync(folder);
    chmodSync(folder, 0o750);
    const refusal = new ChannelError(
      `The runtime folder is open to other users (mode 0750, it must be 0700): ${folder}`,
    );

    await expect(unixSocketChannel(folder).listen(() => recorder().events)).rejects.toThrow(
      refusal,
    );
    await expect(unixSocketChannel(folder).connect(recorder().events)).rejects.toThrow(refusal);
    expect(mode(folder)).toBe(0o750);
    expect(existsSync(join(folder, "goop.sock"))).toBe(false);
  });

  test("a symbolic link as the folder is refused", async () => {
    const parent = scratch();
    const target = join(parent, "target");
    mkdirSync(target, { mode: 0o700 });
    const folder = join(parent, "run");
    symlinkSync(target, folder);

    await expect(unixSocketChannel(folder).listen(() => recorder().events)).rejects.toThrow(
      new ChannelError(`The runtime folder is not a folder: ${folder}`),
    );
    expect(existsSync(join(target, "goop.sock"))).toBe(false);
  });

  test("a socket left by a daemon that died is replaced", async () => {
    const folder = join(scratch(), "run");
    mkdirSync(folder, { mode: 0o700 });
    const path = join(folder, "goop.sock");
    const dead = Bun.spawn([
      process.execPath,
      "-e",
      `Bun.listen({ unix: ${JSON.stringify(path)}, socket: { data() {} } });
       process.kill(process.pid, "SIGKILL");`,
    ]);
    await dead.exited;
    expect(lstatSync(path).isSocket()).toBe(true);

    await echoDaemon(folder);
    const client = recorder();
    const connection = await unixSocketChannel(folder).connect(client.events);
    connection.send({ jsonrpc: "2.0", id: 1, method: "ping" });
    await client.received(1);
    expect(mode(path)).toBe(0o600);
  });

  test("a second daemon is refused and the first keeps working", async () => {
    const folder = join(scratch(), "run");
    await echoDaemon(folder);

    await expect(unixSocketChannel(folder).listen(() => recorder().events)).rejects.toThrow(
      new ChannelError("goop daemon is already running"),
    );
    const client = recorder();
    const connection = await unixSocketChannel(folder).connect(client.events);
    connection.send({ jsonrpc: "2.0", id: 1, method: "ping" });
    await client.received(1);
  });

  test("a goop.sock that is not a socket is refused and left as it is", async () => {
    const folder = join(scratch(), "run");
    mkdirSync(folder, { mode: 0o700 });
    const path = join(folder, "goop.sock");
    writeFileSync(path, "not a socket");

    await expect(unixSocketChannel(folder).listen(() => recorder().events)).rejects.toThrow(
      new ChannelError(`Something that is not a socket is in the way: ${path}`),
    );
    expect(statSync(path).isFile()).toBe(true);
  });

  test("a socket path over the limit is refused; one at the limit works", async () => {
    const parent = scratch();
    const room = MAX_SOCKET_PATH_BYTES - parent.length - "/".length - "/goop.sock".length;
    const long = join(parent, "a".repeat(room + 1));
    expect(() => unixSocketChannel(long)).toThrow(
      new ChannelError(`The socket path is 108 bytes, over the limit of 107: ${long}/goop.sock`),
    );

    const fits = join(parent, "a".repeat(room));
    await echoDaemon(fits);
    const client = recorder();
    const connection = await unixSocketChannel(fits).connect(client.events);
    connection.send({ jsonrpc: "2.0", id: 1, method: "ping" });
    await client.received(1);
  });

  test("closing the listener closes its connections and removes the socket", async () => {
    const folder = join(scratch(), "run");
    const { listener } = await echoDaemon(folder);
    const client = recorder();
    await unixSocketChannel(folder).connect(client.events);

    await listener.close();

    await client.closed();
    expect(existsSync(join(folder, "goop.sock"))).toBe(false);
    await expect(unixSocketChannel(folder).connect(recorder().events)).rejects.toThrow(
      new ChannelError("goop daemon is not running"),
    );
  });

  test("connecting with no daemon says so", async () => {
    const folder = join(scratch(), "run");
    await expect(unixSocketChannel(folder).connect(recorder().events)).rejects.toThrow(
      new ChannelError("goop daemon is not running"),
    );
    mkdirSync(folder, { mode: 0o700 });
    await expect(unixSocketChannel(folder).connect(recorder().events)).rejects.toThrow(
      new ChannelError("goop daemon is not running"),
    );
  });
});
