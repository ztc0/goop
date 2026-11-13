// Where the daemon keeps the vault, and which OS key store seals its data key (goop S25,
// dev-sandbox S8). Pure: `src/main.ts` hands it the environment.
import { isAbsolute, join, relative, resolve, sep } from "node:path";

type Environment = Readonly<Record<string, string | undefined>>;

const absolute = (path: string | undefined) => (path && isAbsolute(path) ? path : undefined);

/**
 * `GOOP_HOME` (`.local/` while developing), else `$XDG_DATA_HOME/goop`, else
 * `~/.local/share/goop`; the vault lives in its `data/`. Undefined when no absolute path is set.
 */
export function vaultLocation(env: Environment): { goopHome: string; data: string } | undefined {
  const xdg = absolute(env.XDG_DATA_HOME);
  const home = absolute(env.HOME);
  const goopHome =
    absolute(env.GOOP_HOME) ??
    (xdg && join(xdg, "goop")) ??
    (home && join(home, ".local", "share", "goop"));
  return goopHome === undefined ? undefined : { goopHome, data: join(goopHome, "data") };
}

export const NO_LOCATION = "No data folder: set GOOP_HOME, XDG_DATA_HOME or HOME";

/** Which OS key store seals the data key: decided once, at the daemon's start. */
export type OsKeyStoreChoice =
  /** TPM2 or DPAPI: only the compiled executable outside the repo-local layout. */
  | { kind: "system" }
  /** The insecure development key in `folder` (`<repo>/.temp/dev/`, dev-sandbox S8). */
  | { kind: "dev-insecure"; folder: string }
  /** No OS key store: the passphrase seals the data key. */
  | { kind: "none" }
  /** The development key would be used outside the goop repository: the daemon does not start. */
  | { kind: "refused"; problem: string };

export interface OsKeyStoreFacts {
  env: Environment;
  /** Whether this is the compiled executable (`Bun.isStandaloneExecutable`). */
  standalone: boolean;
  /** The folder above `src/` when goop runs from source. */
  repoRoot: string;
  /** Whether `repoRoot` holds goop's `package.json`. */
  isGoopRepo: boolean;
}

/** Whether `path` is `folder` or inside it, by name only (`..` resolved, links not followed). */
function inside(path: string, folder: string): boolean {
  const rest = relative(folder, resolve(path));
  return rest === "" || (rest !== ".." && !rest.startsWith(`..${sep}`) && !isAbsolute(rest));
}

/**
 * Development never touches the real TPM2 or DPAPI (goop S25): only the compiled executable
 * without `GOOP_HOME` uses them. From source with `GOOP_HOME` in the repo's `.local/` (the layout
 * of `scripts/dev-env/run.ts`), the insecure development key unlocks the vault by itself
 * (dev-sandbox S8); the compiled executable never uses it, and no variable alone turns it on.
 */
export function osKeyStoreChoice(facts: OsKeyStoreFacts): OsKeyStoreChoice {
  // Any GOOP_HOME, even an empty or relative one, keeps the compiled goop off the system store.
  if (facts.standalone) {
    return facts.env.GOOP_HOME === undefined ? { kind: "system" } : { kind: "none" };
  }
  const goopHome = absolute(facts.env.GOOP_HOME);
  if (goopHome === undefined || !inside(goopHome, join(facts.repoRoot, ".local"))) {
    return { kind: "none" };
  }
  if (!facts.isGoopRepo) return { kind: "refused", problem: DEV_KEY_REFUSED };
  return { kind: "dev-insecure", folder: join(facts.repoRoot, ".temp", "dev") };
}

export const NO_OS_KEY_STORE =
  "goop runs from source or with GOOP_HOME, so it never uses the OS key store; the passphrase seals the data key.";

export const DEV_KEY_WARNING =
  "goop daemon is using the insecure development key in .temp/dev/ (never use this for real data).";

export const DEV_KEY_REFUSED =
  "goop will not use the insecure development key: GOOP_HOME is in .local/, but the folder above src/ is not the goop repository.";
