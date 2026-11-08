// Deletes the disposable .temp/ folder. With --local it deletes the persistent
// .local/ folder (models, data, caches) instead, only after typing "delete".
import { existsSync, rmSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { repoRoot } from "@scripts/shared/repo-root";
import { devLayout } from "@/shared/dev";

const args = process.argv.slice(2);
const local = args.length === 1 && args[0] === "--local";
if (args.length > 0 && !local) {
  process.stderr.write("Usage: bun scripts/dev-env/clean.ts [--local]\n");
  process.exit(2);
}

const layout = devLayout(repoRoot());

if (!local) {
  if (!existsSync(layout.temp.root)) {
    process.stdout.write("Nothing to clean: .temp/ does not exist.\n");
    process.exit(0);
  }
  rmSync(layout.temp.root, { recursive: true, force: true });
  process.stdout.write("Removed .temp/\n");
  process.exit(0);
}

if (!process.stdin.isTTY) {
  process.stderr.write("Refusing to delete .local/ without interactive confirmation.\n");
  process.exit(1);
}
if (!existsSync(layout.local.root)) {
  process.stdout.write("Nothing to clean: .local/ does not exist.\n");
  process.exit(0);
}

const prompt = createInterface({ input: process.stdin, output: process.stdout });
const answer = await prompt.question(
  'This deletes .local/ (models, data, caches). Type "delete" to confirm: ',
);
prompt.close();
if (answer.trim() !== "delete") {
  process.stdout.write("Cancelled: .local/ was kept.\n");
  process.exit(1);
}
rmSync(layout.local.root, { recursive: true, force: true });
process.stdout.write("Removed .local/\n");
