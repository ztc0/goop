// T10 spike check, Linux x86_64 entry: embeds libsqlite3mc.so (local build) and vec0.so.
// Run from source:  bun scripts/dev-env/run.ts bun scripts/spikes/encrypted-sqlite/check.ts
// Compile and run:  see docs/research/spike-encrypted-sqlite.md
import { readFileSync } from "node:fs";
import libraryFile from "../../../.local/build/sqlite/libsqlite3mc.so" with { type: "file" };
import libraryHashFile from "../../../.local/build/sqlite/libsqlite3mc.so.sha256" with {
  type: "file",
};
import vecFile from "../../../.local/build/sqlite/vec0.so" with { type: "file" };
import { runSpikeChecks } from "./checks";

// Upstream sha256 of vec0.so inside sqlite-vec-0.1.9-loadable-linux-x86_64.tar.gz (that archive
// matches the release checksums.txt). The libsqlite3mc.so hash comes from the local build.
const VEC0_SHA256 = "5923730861b86c707cca5602b5f91092f9e52a46706dbc6e269fd4bb9c4498e8";

await runSpikeChecks({
  library: {
    file: libraryFile,
    name: "libsqlite3mc.so",
    sha256: readFileSync(libraryHashFile, "utf8").trim(),
  },
  vec: { file: vecFile, name: "vec0.so", sha256: VEC0_SHA256 },
  mode: "dispatch-table",
});
