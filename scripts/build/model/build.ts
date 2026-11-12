import { join } from "node:path";
import type { NativePlatform } from "@/shared/vault";

/** The native libraries every goop executable embeds, by their name in the manifest. */
export const NATIVE_LIBRARIES = ["sqlite3mc"] as const;

export const USAGE = "Usage: bun run build\n";

export type BuildCommand = { kind: "build" } | { kind: "usage"; error: string };

/** `bun run build` builds for the host only, so it takes no arguments. */
export function parseBuildArgs(args: readonly string[]): BuildCommand {
  const [first] = args;
  return first === undefined
    ? { kind: "build" }
    : { kind: "usage", error: `Unknown argument: ${first}` };
}

/** The goop executable: `src/main.ts` compiled into `dist/goop`. */
export function defaultBuild(root: string) {
  return { entry: join(root, "src", "main.ts"), outfile: join(root, "dist", "goop") };
}

/** `.local/build/native/`, where `bun run build:native` writes the libraries. */
export const nativeFolder = (root: string) => join(root, ".local", "build", "native");

export const notBuilt = (platform: NativePlatform) =>
  `goop was not built: run \`bun run build:native --target ${platform}\` first.`;
