import { describe, expect, test } from "bun:test";
import { serveDaemon } from "@/interfaces/daemon/services/serve-daemon";
import { vaultSession } from "@/interfaces/daemon/services/vault-session";
import {
  type FakeVault,
  fakeVault,
  PASSPHRASE,
  SECRETS,
} from "@/interfaces/daemon/tests/unit/fake-vault";
import { type Channel, type ChannelEvents, type JsonRpcMessage, parseMessage } from "@/shared/ipc";

/** An in-memory channel: `client()` opens one connection to the listening daemon. */
function fakeChannel() {
  const state = { listening: false, closed: false };
  let accept:
    | ((connection: { send(m: JsonRpcMessage): void; close(): void }) => ChannelEvents)
    | undefined;
  const channel: Channel = {
    async listen(onAccept) {
      accept = onAccept;
      state.listening = true;
      return {
        async close() {
          state.closed = true;
        },
      };
    },
    connect: () => Promise.reject(new Error("the daemon never connects")),
  };
  /** Sends one request and waits for its reply. */
  async function request(method: string, params?: unknown): Promise<JsonRpcMessage> {
    const { promise, resolve } = Promise.withResolvers<JsonRpcMessage>();
    if (!accept) throw new Error("not listening");
    const events = accept({ send: resolve, close() {} });
    events.message(parseMessage(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })));
    return promise;
  }
  return { channel, state, request };
}

function recordOutput() {
  const lines = { stdout: [] as string[], stderr: [] as string[] };
  return {
    lines,
    output: {
      print: (line: string) => lines.stdout.push(line),
      fail: (line: string) => lines.stderr.push(line),
    },
  };
}

const sessionOf = (vault: FakeVault) =>
  vaultSession({
    files: vault.files,
    os: vault.osEnvelope,
    keys: vault.keys,
    loadEngine: vault.loadEngine,
  });

async function lockedVault() {
  const vault = fakeVault();
  const session = sessionOf(vault);
  await session.open();
  await session.setup(PASSPHRASE);
  session.close();
  return vault;
}

describe("serveDaemon (daemon-ipc S3, S7, L8)", () => {
  test("a locked vault: listens, says it waits for goop, unlocks over the channel", async () => {
    const vault = await lockedVault();
    const { channel, state, request } = fakeChannel();
    const { lines, output } = recordOutput();
    const { promise: stopped, resolve: stop } = Promise.withResolvers();
    const session = sessionOf(vault);

    const served = serveDaemon(() => channel, output, stopped, session);
    await Bun.sleep(0);
    while (lines.stdout.length < 2) await Bun.sleep(1);

    expect(lines.stdout).toEqual([
      "goop daemon is listening.",
      "The vault is locked. Unlock it with: goop",
    ]);
    expect(await request("vault.unlock", { passphrase: PASSPHRASE })).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { state: "unlocked" },
    });
    expect(session.store()).toBeDefined();
    stop(undefined);

    expect(await served).toBe(0);
    expect(state.closed).toBe(true);
    // The store closed with the daemon.
    expect(vault.opened.at(-1)?.closed).toBe(true);
    expect(lines.stdout.at(-1)).toBe("The vault is unlocked.");
    for (const secret of SECRETS) {
      expect([...lines.stdout, ...lines.stderr].join("\n")).not.toContain(secret);
    }
  });

  test.each([
    ["first-run", "The vault is not set up yet. Set it up with: goop"],
    ["needs-recovery", "The vault needs its recovery key. Enter it with: goop"],
  ] as const)("a %s vault says what goop must do", async (status, line) => {
    const vault = status === "first-run" ? fakeVault() : await lockedVault();
    if (status === "needs-recovery") vault.data.delete("data-key.passphrase");
    const { channel } = fakeChannel();
    const { lines, output } = recordOutput();

    expect(await serveDaemon(() => channel, output, Promise.resolve(), sessionOf(vault))).toBe(0);
    expect(lines).toEqual({ stdout: ["goop daemon is listening.", line], stderr: [] });
  });

  test("a busy OS key store, even with a passphrase envelope, says try again (not locked) and exits 1", async () => {
    const vault = fakeVault({ available: true });
    const first = sessionOf(vault);
    await first.open();
    await first.setup(PASSPHRASE);
    first.close();
    vault.data.set(
      "data-key.passphrase",
      await vault.keys.sealWithPassphrase(new Uint8Array(32).fill(7), PASSPHRASE),
    );
    vault.os.availability = { available: false, reason: "busy", message: "DPAPI is busy." };
    const { channel, state } = fakeChannel();
    const { lines, output } = recordOutput();

    expect(await serveDaemon(() => channel, output, new Promise(() => {}), sessionOf(vault))).toBe(
      1,
    );
    expect(state.closed).toBe(true);
    expect(lines).toEqual({
      stdout: [],
      stderr: [
        "The OS key store is unavailable right now (busy), so goop will try again later. The data key is not lost.",
      ],
    });
  });

  test("a vault only a backup can help: says why, closes the channel and exits 1", async () => {
    const vault = await lockedVault();
    vault.data.delete("data-key.passphrase");
    vault.data.delete("data-key.recovery");
    const { channel, state } = fakeChannel();
    const { lines, output } = recordOutput();

    expect(await serveDaemon(() => channel, output, new Promise(() => {}), sessionOf(vault))).toBe(
      1,
    );
    expect(state.closed).toBe(true);
    expect(lines).toEqual({
      stdout: [],
      stderr: [
        "goop cannot start the vault: the store exists but every envelope of its data key is missing; restore the vault folder from a backup. goop never creates a new data key over existing data.",
      ],
    });
  });
});
