import { describe, expect, test } from "bun:test";
import { respond } from "@/interfaces/daemon/services/respond";
import { vaultSession } from "@/interfaces/daemon/services/vault-session";
import {
  type FakeVault,
  fakeVault,
  PASSPHRASE,
  RECOVERY_KEY,
  SECRETS,
  WRONG,
} from "@/interfaces/daemon/tests/unit/fake-vault";
import { parseMessage } from "@/shared/ipc";

const WRONG_SECRET = { code: 1001, message: "The passphrase or recovery key is not right." };
const wrongState = (state: string) => ({
  code: 1002,
  message: `The vault is ${state}, so this cannot be done now.`,
  data: { state },
});
const INVALID_PARAMS = { code: -32602, message: "Invalid params" };

/** A daemon's vault over `vault`, and a function that sends it one request as text. */
async function daemon(vault: FakeVault = fakeVault()) {
  const session = vaultSession({
    files: vault.files,
    os: vault.osEnvelope,
    keys: vault.keys,
    loadEngine: () => vault.loadEngine(),
  });
  await session.open();
  const lines: string[] = [];
  const replies: string[] = [];
  let id = 0;
  async function send(method: string, params?: unknown) {
    id++;
    const text = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const reply = await respond(parseMessage(text), session, (line) => lines.push(line));
    replies.push(JSON.stringify(reply));
    return reply;
  }
  /** No reply and no line holds any secret the tests sent. */
  function expectNoSecret() {
    for (const secret of SECRETS) {
      for (const text of [...replies, ...lines]) expect(text).not.toContain(secret);
    }
  }
  return { session, send, lines, expectNoSecret };
}

async function lockedVault() {
  const vault = fakeVault();
  const { send, session } = await daemon(vault);
  await send("vault.setup", { passphrase: PASSPHRASE });
  session.close();
  return vault;
}

describe("respond: the vault methods (daemon-ipc S7)", () => {
  test("first-run: status, then setup returns the recovery key and unlocks", async () => {
    const d = await daemon();

    expect(await d.send("vault.status")).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { state: "first-run" },
    });
    expect(await d.send("vault.unlock", { passphrase: PASSPHRASE })).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: wrongState("first-run"),
    });
    expect(await d.send("vault.recover", { recoveryKey: RECOVERY_KEY, passphrase: WRONG })).toEqual(
      { jsonrpc: "2.0", id: 3, error: wrongState("first-run") },
    );
    expect(await d.send("vault.setup", { passphrase: PASSPHRASE })).toEqual({
      jsonrpc: "2.0",
      id: 4,
      result: { recoveryKey: RECOVERY_KEY },
    });
    expect(await d.send("vault.status")).toEqual({
      jsonrpc: "2.0",
      id: 5,
      result: { state: "unlocked" },
    });
    expect(d.lines).toEqual(["The vault is unlocked."]);
    // The recovery key is in the setup's reply only; no line holds it.
    for (const line of d.lines) expect(line).not.toContain(RECOVERY_KEY);
  });

  test("locked: a wrong passphrase gets the one fixed error, the right one unlocks", async () => {
    const d = await daemon(await lockedVault());

    expect(await d.send("vault.status")).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { state: "locked" },
    });
    expect(await d.send("vault.setup", { passphrase: WRONG })).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: wrongState("locked"),
    });
    expect(await d.send("vault.unlock", { passphrase: WRONG })).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: WRONG_SECRET,
    });
    expect(await d.send("vault.status")).toEqual({
      jsonrpc: "2.0",
      id: 4,
      result: { state: "locked" },
    });
    expect(await d.send("vault.unlock", { passphrase: PASSPHRASE })).toEqual({
      jsonrpc: "2.0",
      id: 5,
      result: { state: "unlocked" },
    });
    expect(await d.send("vault.unlock", { passphrase: PASSPHRASE })).toEqual({
      jsonrpc: "2.0",
      id: 6,
      error: wrongState("unlocked"),
    });
    expect(d.lines).toEqual([
      "A wrong passphrase or recovery key was refused.",
      "The vault is unlocked.",
    ]);
    d.expectNoSecret();
  });

  test("needs-recovery: a wrong key gets the same error, the right one unlocks", async () => {
    const vault = await lockedVault();
    vault.data.delete("data-key.passphrase");
    const d = await daemon(vault);

    expect(await d.send("vault.status")).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { state: "needs-recovery" },
    });
    expect(await d.send("vault.unlock", { passphrase: PASSPHRASE })).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: wrongState("needs-recovery"),
    });
    expect(await d.send("vault.recover", { recoveryKey: WRONG, passphrase: PASSPHRASE })).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: WRONG_SECRET,
    });
    expect(
      await d.send("vault.recover", { recoveryKey: RECOVERY_KEY, passphrase: PASSPHRASE }),
    ).toEqual({ jsonrpc: "2.0", id: 4, result: { state: "unlocked" } });
    d.expectNoSecret();
  });

  test("params that fail their checks are invalid, and the error holds none of them", async () => {
    const d = await daemon(await lockedVault());

    for (const params of [
      { passphrase: "" },
      { passphrase: "x".repeat(1025) },
      { passphrase: PASSPHRASE, extra: WRONG },
      [PASSPHRASE],
    ]) {
      expect(await d.send("vault.unlock", params)).toMatchObject({
        error: INVALID_PARAMS,
      });
    }
    expect(await d.send("vault.status", { passphrase: PASSPHRASE })).toMatchObject({
      error: INVALID_PARAMS,
    });
    expect(await d.session.status()).toBe("locked");
    expect(d.lines).toEqual([]);
    d.expectNoSecret();
  });

  test("ping keeps working in every state, and other methods are still unknown", async () => {
    const d = await daemon(await lockedVault());

    expect(await d.send("ping")).toEqual({ jsonrpc: "2.0", id: 1, result: "pong" });
    expect(await d.send("vault.delete")).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32601, message: "Method not found" },
    });
  });

  test("a vault method sent as a notification does nothing and gets no reply", async () => {
    const d = await daemon(await lockedVault());
    const text = JSON.stringify({
      jsonrpc: "2.0",
      method: "vault.unlock",
      params: { passphrase: PASSPHRASE },
    });

    expect(await respond(parseMessage(text), d.session, (line) => d.lines.push(line))).toBe(
      undefined,
    );
    expect(await d.session.status()).toBe("locked");
  });

  test("an unexpected failure is an internal error that names only the error's kind", async () => {
    const vault = await lockedVault();
    const d = await daemon(vault);
    vault.loadEngine = async () => {
      throw new TypeError(`the library broke near ${PASSPHRASE}`);
    };

    expect(await d.send("vault.unlock", { passphrase: PASSPHRASE })).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32603, message: "Internal error" },
    });
    expect(d.lines).toEqual(["goop daemon could not run vault.unlock (TypeError)."]);
    expect(await d.session.status()).toBe("locked");
    d.expectNoSecret();
  });
});
