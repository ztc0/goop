// Where the daemon keeps the vault, and whether it may use the OS key store (goop S25). Pure:
// `src/main.ts` hands it the environment.
import { isAbsolute, join } from "node:path";

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

/**
 * Development never touches the real TPM2 or DPAPI (goop S25): only the compiled executable,
 * outside the repo-local layout (no `GOOP_HOME`), seals the data key with the OS key store.
 */
export function usesOsKeyStore(env: Environment, standalone: boolean): boolean {
  return standalone && env.GOOP_HOME === undefined;
}

export const NO_OS_KEY_STORE =
  "goop runs from source or with GOOP_HOME, so it never uses the OS key store; the passphrase seals the data key.";
