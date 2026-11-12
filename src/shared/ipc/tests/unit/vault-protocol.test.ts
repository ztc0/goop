import { describe, expect, test } from "bun:test";
import {
  MAX_PASSPHRASE_CHARS,
  MAX_RECOVERY_KEY_CHARS,
  parseVaultParams,
  readVaultFailure,
  readVaultResult,
  VAULT_ERRORS,
  wrongStateError,
} from "@/shared/ipc";

const SECRET = "hunter2-SECRET";
const RECOVERY_KEY = "0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV-WXYZ";

describe("parseVaultParams (daemon-ipc S4, S7)", () => {
  test("reads the params of each vault method", () => {
    expect(parseVaultParams("vault.status", undefined)).toEqual({ ok: true, params: {} });
    expect(parseVaultParams("vault.status", {})).toEqual({ ok: true, params: {} });
    expect(parseVaultParams("vault.setup", { passphrase: SECRET })).toEqual({
      ok: true,
      params: { passphrase: SECRET },
    });
    expect(parseVaultParams("vault.unlock", { passphrase: SECRET })).toEqual({
      ok: true,
      params: { passphrase: SECRET },
    });
    expect(
      parseVaultParams("vault.recover", { recoveryKey: RECOVERY_KEY, passphrase: SECRET }),
    ).toEqual({ ok: true, params: { recoveryKey: RECOVERY_KEY, passphrase: SECRET } });
  });

  test("the longest passphrase and recovery key pass, one character more is refused", () => {
    const longest = "ñ".repeat(MAX_PASSPHRASE_CHARS);
    expect(parseVaultParams("vault.unlock", { passphrase: longest }).ok).toBe(true);
    expect(parseVaultParams("vault.unlock", { passphrase: `${longest}a` }).ok).toBe(false);

    const key = "A".repeat(MAX_RECOVERY_KEY_CHARS);
    expect(parseVaultParams("vault.recover", { recoveryKey: key, passphrase: SECRET }).ok).toBe(
      true,
    );
    expect(
      parseVaultParams("vault.recover", { recoveryKey: `${key}A`, passphrase: SECRET }).ok,
    ).toBe(false);
  });

  test.each([
    ["vault.status", { passphrase: SECRET }],
    ["vault.status", [SECRET]],
    ["vault.setup", undefined],
    ["vault.setup", { passphrase: "" }],
    ["vault.setup", { passphrase: 42 }],
    ["vault.setup", [SECRET]],
    ["vault.unlock", { passphrase: SECRET, extra: SECRET }],
    ["vault.unlock", {}],
    ["vault.recover", { recoveryKey: RECOVERY_KEY }],
    ["vault.recover", { recoveryKey: "", passphrase: SECRET }],
    ["vault.recover", { passphrase: SECRET }],
  ] as const)("%s with %j is refused, and the refusal holds no input", (method, params) => {
    const parsed = parseVaultParams(method, params);
    expect(parsed).toEqual({ ok: false });
    expect(JSON.stringify(parsed)).not.toContain(SECRET);
  });
});

describe("the vault errors (daemon-ipc S7)", () => {
  test("a wrong passphrase or recovery key has one fixed error", () => {
    expect(VAULT_ERRORS.wrongSecret).toEqual({
      code: 1001,
      message: "The passphrase or recovery key is not right.",
    });
  });

  test("a method the vault's state does not allow names the state", () => {
    expect(wrongStateError("locked")).toEqual({
      code: 1002,
      message: "The vault is locked, so this cannot be done now.",
      data: { state: "locked" },
    });
  });

  test("goop reads each error back, and anything else as unknown", () => {
    expect(readVaultFailure(VAULT_ERRORS.wrongSecret)).toEqual({ kind: "wrong-secret" });
    expect(readVaultFailure(VAULT_ERRORS.keyStoreUnavailable)).toEqual({
      kind: "key-store-unavailable",
    });
    expect(readVaultFailure(wrongStateError("first-run"))).toEqual({
      kind: "wrong-state",
      state: "first-run",
    });
    expect(readVaultFailure({ code: 1002, message: "x", data: { state: "\u001b[2J" } })).toEqual({
      kind: "unknown",
    });
    expect(readVaultFailure({ code: -32603, message: "Internal error" })).toEqual({
      kind: "unknown",
    });
  });
});

describe("readVaultResult", () => {
  test("reads the status, the recovery key and the unlocked state", () => {
    expect(readVaultResult("vault.status", { state: "locked" })).toEqual({ state: "locked" });
    expect(readVaultResult("vault.setup", { recoveryKey: RECOVERY_KEY })).toEqual({
      recoveryKey: RECOVERY_KEY,
    });
    expect(readVaultResult("vault.unlock", { state: "unlocked" })).toEqual({ state: "unlocked" });
    expect(readVaultResult("vault.recover", { state: "unlocked" })).toEqual({ state: "unlocked" });
  });

  test.each([
    ["vault.status", { state: "open" }],
    ["vault.status", "locked"],
    ["vault.setup", { recoveryKey: "\u001b[2J" }],
    ["vault.setup", { recoveryKey: "0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV-WXYI" }],
    ["vault.unlock", { state: "locked" }],
  ] as const)("refuses %s result %j", (method, result) => {
    expect(readVaultResult(method, result)).toBeUndefined();
  });
});
