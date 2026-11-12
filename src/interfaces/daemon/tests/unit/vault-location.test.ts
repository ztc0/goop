import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { usesOsKeyStore, vaultLocation } from "@/interfaces/daemon/model/vault-location";

describe("vaultLocation (goop S25)", () => {
  test("GOOP_HOME holds everything: the vault in its data/ folder", () => {
    expect(vaultLocation({ GOOP_HOME: "/repo/.local", HOME: "/home/u" })).toEqual({
      goopHome: "/repo/.local",
      data: join("/repo/.local", "data"),
    });
  });

  test("without GOOP_HOME: $XDG_DATA_HOME/goop, else ~/.local/share/goop", () => {
    expect(vaultLocation({ XDG_DATA_HOME: "/x/share", HOME: "/home/u" })).toEqual({
      goopHome: join("/x/share", "goop"),
      data: join("/x/share", "goop", "data"),
    });
    expect(vaultLocation({ HOME: "/home/u" })).toEqual({
      goopHome: join("/home/u", ".local", "share", "goop"),
      data: join("/home/u", ".local", "share", "goop", "data"),
    });
  });

  test("relative or empty paths are ignored, and with nothing left there is no location", () => {
    expect(vaultLocation({ GOOP_HOME: "", XDG_DATA_HOME: "share", HOME: "/home/u" })).toEqual({
      goopHome: join("/home/u", ".local", "share", "goop"),
      data: join("/home/u", ".local", "share", "goop", "data"),
    });
    expect(vaultLocation({ GOOP_HOME: ".local", HOME: "home" })).toBeUndefined();
    expect(vaultLocation({})).toBeUndefined();
  });
});

describe("usesOsKeyStore (goop S25)", () => {
  test("only the compiled executable without GOOP_HOME uses the OS key store", () => {
    expect(usesOsKeyStore({}, true)).toBe(true);
    expect(usesOsKeyStore({ GOOP_HOME: "/repo/.local" }, true)).toBe(false);
    expect(usesOsKeyStore({}, false)).toBe(false);
    expect(usesOsKeyStore({ GOOP_HOME: "/repo/.local" }, false)).toBe(false);
  });
});
