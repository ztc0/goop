import type { EngineName } from "../../sandbox/types/sandbox";
import type { BuildCommand } from "../types/native-build";

export const USAGE = `Usage: bun run native:build [--engine podman|docker]

Builds libsqlite3mc.so for linux-x64 in a fresh container from the pinned Debian image,
then writes .local/build/native/linux-x64/libsqlite3mc.so and .local/build/native/manifest.json.

Options:
  --engine <engine> podman or docker; by default Podman if installed, else Docker
`;

const ENGINES: readonly string[] = ["podman", "docker"] satisfies EngineName[];

/** The command line: only an optional `--engine`, as in the sandbox. */
export function parseBuildArgs(argv: string[]): BuildCommand {
  let engine: EngineName | undefined;
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    if (option !== "--engine") return { error: `Unknown argument: ${option}` };
    const value = argv[index + 1];
    if (value === undefined) return { error: "--engine needs a value." };
    if (!ENGINES.includes(value)) {
      return { error: `Unknown --engine: ${value} (expected podman or docker).` };
    }
    if (engine !== undefined) return { error: "--engine is given more than once." };
    engine = value as EngineName;
  }
  return { engine };
}
