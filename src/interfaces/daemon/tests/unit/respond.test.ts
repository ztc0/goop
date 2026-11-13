import { describe, expect, test } from "bun:test";
import { explanation, failureLine, respond } from "@/interfaces/daemon/services/respond";
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
import {
  KeyStoreUnavailableError,
  NativeLibraryError,
  NativeManifestError,
  parseNativeManifest,
  StoreLibraryError,
  VaultStateError,
} from "@/shared/vault";

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

  test("an unexpected failure is an internal error with one fixed line", async () => {
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
    expect(d.lines).toEqual(["goop daemon could not run vault.unlock."]);
    expect(await d.session.status()).toBe("locked");
    d.expectNoSecret();
  });

  test("an unexpected error's name is never printed either", async () => {
    const vault = fakeVault();
    const d = await daemon(vault);
    const error = new Error(PASSPHRASE);
    error.name = "SECRET";
    vault.loadEngine = async () => {
      throw error;
    };

    expect(await d.send("vault.setup", { passphrase: PASSPHRASE })).toMatchObject({
      error: { code: -32603, message: "Internal error" },
    });
    expect(d.lines).toEqual(["goop daemon could not run vault.setup."]);
    d.expectNoSecret();
  });

  test("a native-manifest failure never echoes the passphrase it was given (S7)", async () => {
    const vault = fakeVault();
    const d = await daemon(vault);
    const before = [...vault.data.keys()];
    vault.loadEngine = async () => {
      // A crafted manifest whose value is the passphrase: the parser quotes it in its message.
      parseNativeManifest(JSON.stringify({ version: PASSPHRASE }));
      return fakeVault().loadEngine();
    };

    expect(await d.send("vault.setup", { passphrase: PASSPHRASE })).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32603, message: "Internal error" },
    });
    expect(d.lines).toEqual([
      "goop daemon could not run vault.setup: the native library manifest of this build cannot be trusted or lacks a library goop needs.",
    ]);
    expect([...vault.data.keys()]).toEqual(before);
    expect(await d.session.status()).toBe("first-run");
    d.expectNoSecret();
  });
});

/** `error` with `message` replaced: what a message that quotes an outside value would hold. */
const holding = <T extends Error>(error: T, message: string): T =>
  Object.assign(error, { message });

describe("failureLine: only goop's own fixed text (daemon-ipc S7)", () => {
  const WHAT = "goop daemon could not run vault.setup";

  test.each([
    [
      "NativeManifestError",
      new NativeManifestError(PASSPHRASE),
      "the native library manifest of this build cannot be trusted or lacks a library goop needs.",
    ],
    [
      "NativeLibraryError",
      new NativeLibraryError(PASSPHRASE),
      "a native library of this build is missing or differs from the one the build pinned.",
    ],
    [
      "StoreLibraryError",
      new StoreLibraryError(PASSPHRASE),
      "the encrypted store library could not be loaded.",
    ],
    [
      "KeyStoreUnavailableError",
      holding(new KeyStoreUnavailableError("busy"), PASSPHRASE),
      "The OS key store is unavailable right now (busy), so goop will try again later. The data key is not lost.",
    ],
    [
      "VaultStateError",
      holding(new VaultStateError("needs-backup", "start"), PASSPHRASE),
      "goop cannot start the vault: the store exists but every envelope of its data key is missing; restore the vault folder from a backup. goop never creates a new data key over existing data.",
    ],
  ])("a %s says one fixed line, never its message", (_kind, error, line) => {
    expect(failureLine(WHAT, error)).toBe(`${WHAT}: ${line}`);
  });

  test.each(["first-run", "ready", "needs-recovery", "needs-backup", "store-missing"] as const)(
    "the fixed line of a %p vault is what the vault says when it cannot start",
    (state) => {
      const error = new VaultStateError(state, "start");
      expect(explanation(error)).toBe(error.message);
    },
  );

  test.each([
    "turned-off",
    "unsupported-platform",
    "missing-tool",
    "old-version",
    "no-tpm2",
    "unreadable",
    "busy",
  ] as const)("the fixed line of an OS key store unavailable (%p) is the vault's own", (reason) => {
    const error = new KeyStoreUnavailableError(reason);
    expect(explanation(error)).toBe(error.message);
  });

  test("an unknown error, or a known one with an unknown reason or state, says only what failed", () => {
    const named = new Error(PASSPHRASE);
    named.name = "SECRET";
    const reason = holding(new KeyStoreUnavailableError("busy"), PASSPHRASE);
    Object.assign(reason, { reason: PASSPHRASE });
    const state = holding(new VaultStateError("needs-backup", "start"), PASSPHRASE);
    Object.assign(state, { state: PASSPHRASE });

    for (const error of [named, reason, state, PASSPHRASE, undefined]) {
      expect(failureLine(WHAT, error)).toBe(`${WHAT}.`);
    }
  });
});
