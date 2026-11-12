// The daemon's vault wired to the real pieces (daemon-ipc S3, goop S25): the vault folder on disk,
// the OS key store only in the compiled executable outside the repo-local layout, and the store
// engine on the native library checked against its pin before every open (built while developing,
// embedded in the executable).
import { join } from "node:path";
import {
  NO_LOCATION,
  NO_OS_KEY_STORE,
  usesOsKeyStore,
  vaultLocation,
} from "@/interfaces/daemon/model/vault-location";
import { type VaultSession, vaultSession } from "@/interfaces/daemon/services/vault-session";
import {
  builtNativeLibrary,
  bunEmbeddedFiles,
  embeddedNativeLibrary,
  nativeLibrarySource,
  nativePlatform,
  nodeVaultFiles,
  noOsKeyEnvelope,
  sqlite3mcEngine,
  systemdCredsEnvelope,
} from "@/shared/vault";

export interface DaemonVaultOptions {
  env: Readonly<Record<string, string | undefined>>;
  /** The repository, whose `.local/build/native/` holds the built libraries when run from source. */
  repoRoot: string;
  standalone?: boolean;
}

/** The daemon's vault, or the reason there is none (no data folder can be found). */
export function daemonVault(options: DaemonVaultOptions): VaultSession | string {
  const standalone = options.standalone ?? Bun.isStandaloneExecutable;
  const location = vaultLocation(options.env);
  if (!location) return NO_LOCATION;
  const os = usesOsKeyStore(options.env, standalone)
    ? systemdCredsEnvelope()
    : noOsKeyEnvelope(NO_OS_KEY_STORE);

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

  return vaultSession({ files: nodeVaultFiles(location.data), os, loadEngine });
}
