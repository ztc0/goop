import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  DEV_KEY_REFUSED,
  DEV_KEY_WARNING,
  osKeyStoreChoice,
  vaultLocation,
} from "@/interfaces/daemon/model/vault-location";

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

const REPO = join("/work", "goop");
const LOCAL = join(REPO, ".local");
const DEV_FOLDER = join(REPO, ".temp", "dev");
const DEV_HOME = join(DEV_FOLDER, "home");

/** From source in the goop repository, unless a test says otherwise. */
const choice = (
  env: Record<string, string>,
  facts: { standalone?: boolean; isGoopRepo?: boolean } = {},
) =>
  osKeyStoreChoice({
    env,
    standalone: facts.standalone ?? false,
    repoRoot: REPO,
    isGoopRepo: facts.isGoopRepo ?? true,
  });

describe("osKeyStoreChoice (goop S25, dev-sandbox S8)", () => {
  test("the compiled executable without GOOP_HOME uses the system key store", () => {
    expect(choice({}, { standalone: true })).toEqual({ kind: "system" });
    expect(choice({ HOME: "/home/u" }, { standalone: true, isGoopRepo: false })).toEqual({
      kind: "system",
    });
  });

  test("the compiled executable never uses the development key, whatever its environment", () => {
    for (const env of [
      { GOOP_HOME: DEV_HOME },
      { GOOP_HOME: DEV_FOLDER },
      { GOOP_HOME: DEV_HOME, GOOP_DEV_KEY: "1", GOOP_INSECURE_DEV_KEY: "1" },
      { GOOP_HOME: LOCAL },
      { GOOP_HOME: "/elsewhere" },
      { GOOP_HOME: "" },
      { GOOP_HOME: ".local" },
    ]) {
      expect(choice(env, { standalone: true })).toEqual({ kind: "none" });
    }
  });

  test("from source with GOOP_HOME in the repo's .temp/dev/, the development key in .temp/dev/", () => {
    for (const home of [DEV_FOLDER, `${DEV_HOME}/`, DEV_HOME, join(DEV_HOME, "sub")]) {
      expect(choice({ GOOP_HOME: home })).toEqual({ kind: "dev-insecure", folder: DEV_FOLDER });
    }
  });

  test("from source anywhere else: the passphrase only, as before", () => {
    for (const env of [
      {},
      { HOME: "/home/u" },
      { GOOP_HOME: join(REPO, ".temp", "tests", "x", "home") },
      { GOOP_HOME: join(REPO, ".temp") },
      { GOOP_HOME: join(REPO, ".temp", "devx") },
      { GOOP_HOME: `${DEV_FOLDER}/../tests` },
      { GOOP_HOME: LOCAL },
      { GOOP_HOME: join(LOCAL, "sub") },
      { GOOP_HOME: join("/other", "goop", ".temp", "dev") },
      { GOOP_HOME: ".temp/dev" },
      { GOOP_HOME: REPO },
      { GOOP_HOME: join(REPO, ".localx") },
      { GOOP_HOME: join(REPO, "..", ".local") },
      { GOOP_HOME: `${LOCAL}/../elsewhere` },
      { GOOP_HOME: join("/other", "goop", ".local") },
      { GOOP_HOME: ".local" },
      { GOOP_HOME: "" },
    ]) {
      expect(choice(env)).toEqual({ kind: "none" });
    }
  });

  test("no environment variable alone turns the development key on", () => {
    for (const env of [
      { GOOP_DEV_KEY: "1" },
      { GOOP_INSECURE_DEV_KEY: "1" },
      { NODE_ENV: "development" },
    ]) {
      expect(choice(env)).toEqual({ kind: "none" });
      expect(choice(env, { standalone: true })).toEqual({ kind: "system" });
    }
  });

  test("the development key outside a confirmed goop repository is refused", () => {
    expect(choice({ GOOP_HOME: DEV_HOME }, { isGoopRepo: false })).toEqual({
      kind: "refused",
      problem: DEV_KEY_REFUSED,
    });
    expect(DEV_KEY_REFUSED).toBe(
      "goop will not use the insecure development key: GOOP_HOME is in .temp/dev/, but the folder above src/ is not the goop repository.",
    );
    // Only the development key needs the repository.
    expect(choice({}, { isGoopRepo: false })).toEqual({ kind: "none" });
  });

  test("the warning names the key's folder and never the key", () => {
    expect(DEV_KEY_WARNING).toBe(
      "goop daemon is using the insecure development key in .temp/dev/ (never use this for real data).",
    );
  });
});
