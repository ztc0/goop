// Runs a command inside the repo-local development environment (S25, S26):
// goop, Bun, uv and Hugging Face write to .local/, temporary files go to .temp/.
import { mkdirSync } from "node:fs";
import { devEnvironment, devLayout, layoutDirectories } from "@/shared/model/dev-layout";
import { repoRoot } from "./repo-root";

const command = process.argv.slice(2);
if (command.length === 0) {
  process.stderr.write("Usage: bun scripts/run.ts <command> [args...]\n");
  process.exit(2);
}

const layout = devLayout(repoRoot());
for (const directory of layoutDirectories(layout)) {
  mkdirSync(directory, { recursive: true });
}

const child = Bun.spawn(command, {
  env: { ...process.env, ...devEnvironment(layout) },
  stdio: ["inherit", "inherit", "inherit"],
});
process.exit(await child.exited);
