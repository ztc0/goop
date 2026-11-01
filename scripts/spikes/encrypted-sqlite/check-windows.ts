// T10 spike check, Windows x64 entry: embeds the official sqlite3mc_x64.dll and vec0.dll.
// Fetch:    bun scripts/dev-env/run.ts bun scripts/spikes/encrypted-sqlite/build-artifacts.ts windows
// Compile:  bun scripts/dev-env/run.ts bun build --compile --target=bun-windows-x64 \
//             scripts/spikes/encrypted-sqlite/check-windows.ts \
//             --outfile .local/build/sqlite/windows/goop-spike-check.exe
import libraryFile from "../../../.local/build/sqlite/windows/sqlite3mc_x64.dll" with {
  type: "file",
};
import vecFile from "../../../.local/build/sqlite/windows/vec0.dll" with { type: "file" };
import { runSpikeChecks } from "./checks";

// Upstream sha256 of each DLL inside its release archive; both archives match the release
// checksum files (sqlite3mc-2.6.1-SHA256SUMS, sqlite-vec checksums.txt).
const SQLITE3MC_X64_SHA256 = "683927db7e16cca301c5f2a236830de28c26b47f01d948f6abf2f0d60776ce4d";
const VEC0_DLL_SHA256 = "fcf98662a7ad9dce394b96a88f91032047823831b951c76636787c312a6476e6";

// The official DLL exports plain sqlite3_* names; Windows resolves imports per module, so
// they do not interpose on Bun's own SQLite.
await runSpikeChecks({
  library: { file: libraryFile, name: "sqlite3mc_x64.dll", sha256: SQLITE3MC_X64_SHA256 },
  vec: { file: vecFile, name: "vec0.dll", sha256: VEC0_DLL_SHA256 },
  mode: "exports",
});
