// Compiled by `scripts/build/tests/integration/build.test.ts` with the real libraries embedded:
// loads sqlite3mc the way the distributed goop does (S6) and prints what it loaded.
import { join } from "node:path";
import {
  bunEmbeddedFiles,
  embeddedNativeLibrary,
  nativeLibrarySource,
  nativePlatform,
  newDataKey,
  sqlite3mcEngine,
} from "@/shared/vault";

const goopHome = process.env.GOOP_HOME;
if (!goopHome) throw new Error("GOOP_HOME is not set");
const embedded = bunEmbeddedFiles();
const source = nativeLibrarySource(
  Bun.isStandaloneExecutable,
  embedded.map((file) => file.name),
);
if (source !== "embedded") throw new Error(`expected the embedded libraries, got ${source}`);
const library = await embeddedNativeLibrary({
  goopHome,
  name: "sqlite3mc",
  platform: nativePlatform(process.platform, process.arch),
  embedded,
});
const store = sqlite3mcEngine({ library }).open(join(goopHome, "check.db"), newDataKey());
const [row] = store.query("SELECT sqlite_version() AS version");
store.close();
console.log(JSON.stringify({ source, library, version: row?.version }));
