// Which OS key store `daemonVault` wires in (goop S25, dev-sandbox S8), on a fake repository under
// `.temp/tests/`: the insecure development key only from source with GOOP_HOME in its `.temp/dev/`,
// never in the compiled executable, and never outside a goop repository.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { daemonVault } from "@/interfaces/daemon";
import { DEV_KEY_REFUSED, DEV_KEY_WARNING } from "@/interfaces/daemon/model/vault-location";

const repo = resolve(import.meta.dir, "..", "..", "..", "..", "..");
let fake: string;

beforeEach(() => {
  fake = join(repo, ".temp", "tests", `daemon-vault-${crypto.randomUUID().slice(0, 8)}`);
  mkdirSync(fake, { recursive: true });
  writeFileSync(join(fake, "package.json"), JSON.stringify({ name: "goop" }));
});

afterEach(() => {
  rmSync(fake, { recursive: true, force: true });
});

const devHome = () => join(fake, ".temp", "dev", "home");

function wired(env: Record<string, string>, standalone = false) {
  const vault = daemonVault({ env, repoRoot: fake, standalone });
  if (typeof vault === "string") return vault;
  return { warning: vault.warning };
}

describe("daemonVault: the OS key store it uses", () => {
  test.skipIf(process.platform === "win32")(
    "a link inside .temp/dev/ that points outside the repo never turns the development key on",
    () => {
      const outside = join(fake, "..", `outside-${crypto.randomUUID().slice(0, 8)}`);
      mkdirSync(outside, { recursive: true });
      mkdirSync(devHome(), { recursive: true });
      symlinkSync(outside, join(devHome(), "escape"));
      try {
        const vault = wired({ GOOP_HOME: join(devHome(), "escape") });
        expect(typeof vault === "string" ? vault : vault.warning).toBeUndefined();
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  test.skipIf(process.platform === "win32")(
    "a broken link inside .temp/dev/ that points outside, or a link loop, never turns it on",
    () => {
      const dev = join(fake, ".temp", "dev");
      mkdirSync(dev, { recursive: true });
      symlinkSync(
        join(fake, "..", `missing-${crypto.randomUUID().slice(0, 8)}`),
        join(dev, "escape"),
      );
      symlinkSync(join(dev, "loop-b"), join(dev, "loop-a"));
      symlinkSync(join(dev, "loop-a"), join(dev, "loop-b"));
      for (const home of [join(dev, "escape"), join(dev, "escape", "home"), join(dev, "loop-a")]) {
        const vault = wired({ GOOP_HOME: home });
        expect(typeof vault === "string" ? vault : vault.warning).toBeUndefined();
      }
    },
  );

  test("from source with GOOP_HOME in the repo's .temp/dev/: the development key, with its warning", async () => {
    const vault = daemonVault({ env: { GOOP_HOME: devHome() }, repoRoot: fake, standalone: false });
    if (typeof vault === "string") throw new Error(vault);

    expect(vault.warning).toBe(DEV_KEY_WARNING);
    expect(await vault.session.open()).toBe("first-run");
    // Nothing is written until the vault is set up.
    expect(readdirSync(fake)).toEqual(["package.json"]);
  });

  test("the compiled executable never uses it, even with GOOP_HOME in a goop repository", () => {
    expect(wired({ GOOP_HOME: devHome() }, true)).toEqual({ warning: undefined });
    expect(wired({ GOOP_HOME: devHome(), GOOP_DEV_KEY: "1" }, true)).toEqual({
      warning: undefined,
    });
  });

  test("from source elsewhere, no warning: the passphrase seals the data key", () => {
    expect(wired({ GOOP_HOME: join(fake, "home") })).toEqual({ warning: undefined });
    expect(wired({ HOME: join(fake, "home"), GOOP_DEV_KEY: "1" })).toEqual({ warning: undefined });
  });

  test("outside a goop repository the daemon refuses the development key", () => {
    writeFileSync(join(fake, "package.json"), JSON.stringify({ name: "not-goop" }));
    expect(wired({ GOOP_HOME: devHome() })).toBe(DEV_KEY_REFUSED);
    writeFileSync(join(fake, "package.json"), "not json");
    expect(wired({ GOOP_HOME: devHome() })).toBe(DEV_KEY_REFUSED);
    rmSync(join(fake, "package.json"));
    expect(wired({ GOOP_HOME: devHome() })).toBe(DEV_KEY_REFUSED);
    expect(existsSync(join(fake, ".temp"))).toBe(false);
  });
});
