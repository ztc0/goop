// The daemon's vault wired to the real pieces (daemon-ipc S3, goop S25, dev-sandbox S8): the vault
// folder on disk, the OS key store only in the compiled executable outside the repo-local layout,
// the insecure development key only from source in the repo's layout, and the store engine on the
// native library checked against its pin before every open (built while developing, embedded in
// the executable).
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import {
  DEV_KEY_WARNING,
  NO_LOCATION,
  NO_OS_KEY_STORE,
  type OsKeyStoreChoice,
  osKeyStoreChoice,
  vaultLocation,
} from "@/interfaces/daemon/model/vault-location";
import { type VaultSession, vaultSession } from "@/interfaces/daemon/services/vault-session";
import {
  builtNativeLibrary,
  bunEmbeddedFiles,
  embeddedNativeLibrary,
  insecureDevKeyEnvelope,
  nativeLibrarySource,
  nativePlatform,
  nodeVaultFiles,
  noOsKeyEnvelope,
  type OsKeyEnvelope,
  sqlite3mcEngine,
  systemdCredsEnvelope,
} from "@/shared/vault";

export interface DaemonVaultOptions {
  env: Readonly<Record<string, string | undefined>>;
  /** The repository, whose `.local/build/native/` holds the built libraries when run from source. */
  repoRoot: string;
  standalone?: boolean;
}

export interface DaemonVault {
  session: VaultSession;
  /** A fixed line the daemon prints at start when it uses the insecure development key. */
  warning: string | undefined;
}

/** Whether `repoRoot` holds goop's `package.json`: the development key needs the goop repo. */
function isGoopRepo(repoRoot: string): boolean {
  try {
    return JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))?.name === "goop";
  } catch {
    return false;
  }
}

/**
 * `path` with every link resolved, even when its last folders do not exist yet: the nearest
 * existing folder is resolved and the rest appended. A link inside `.temp/dev/` that points outside
 * the repository must not pass for the development layout.
 */
function realPath(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path ? path : join(realPath(parent), basename(path));
}

function osKeyEnvelope(choice: OsKeyStoreChoice, standalone: boolean): OsKeyEnvelope {
  switch (choice.kind) {
    case "system":
      return systemdCredsEnvelope();
    // The envelope refuses the compiled executable too, whatever the choice said.
    case "dev-insecure":
      return insecureDevKeyEnvelope(choice.folder, { standalone });
    default:
      return noOsKeyEnvelope(NO_OS_KEY_STORE);
  }
}

/**
 * The daemon's vault, or the reason there is none: no data folder can be found, or the
 * development key would be used outside the goop repository.
 */
export function daemonVault(options: DaemonVaultOptions): DaemonVault | string {
  const standalone = options.standalone ?? Bun.isStandaloneExecutable;
  const location = vaultLocation(options.env);
  if (!location) return NO_LOCATION;
  const goopHome = options.env.GOOP_HOME;
  const choice = osKeyStoreChoice({
    // Links resolved, so the `.temp/dev/` check compares where the folders really are.
    env:
      !standalone && goopHome && isAbsolute(goopHome)
        ? { ...options.env, GOOP_HOME: realPath(goopHome) }
        : options.env,
    standalone,
    repoRoot: standalone ? options.repoRoot : realPath(options.repoRoot),
    // Read only from source: the compiled executable has no repository.
    isGoopRepo: !standalone && isGoopRepo(options.repoRoot),
  });
  if (choice.kind === "refused") return choice.problem;
  const os = osKeyEnvelope(choice, standalone);

  async function loadEngine() {
    const platform = nativePlatform(process.platform, process.arch);
    const embedded = bunEmbeddedFiles();
    const source = nativeLibrarySource(
      standalone,
      embedded.map((file) => file.name),
    );
    const library =
      source === "embedded"
        ? await embeddedNativeLibrary({
            goopHome: location?.goopHome ?? "",
            name: "sqlite3mc",
            platform,
            embedded,
          })
        : await builtNativeLibrary({
            folder: join(options.repoRoot, ".local", "build", "native"),
            name: "sqlite3mc",
            platform,
          });
    return sqlite3mcEngine({ library });
  }

  return {
    session: vaultSession({ files: nodeVaultFiles(location.data), os, loadEngine }),
    warning: choice.kind === "dev-insecure" ? DEV_KEY_WARNING : undefined,
  };
}
