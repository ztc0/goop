import { join } from "node:path";
import type { DevPaths } from "@scripts/dev/types/dev";

/**
 * Every path `bun run dev` uses, from the repo root (S7). Podman keeps its storage in the same
 * folders as the sandbox, so the two share the pulled Debian base.
 */
export function devPaths(root: string): DevPaths {
  const local = join(root, ".local");
  const temp = join(root, ".temp");
  const devTemp = join(temp, "dev");
  return {
    root,
    containerStorage: join(local, "containers", "storage"),
    containerRunRoot: join(temp, "containers", "run"),
    containerTmp: join(temp, "containers", "tmp"),
    containerfile: join(root, "scripts", "dev", "Containerfile"),
    entrypoint: join(root, "scripts", "dev", "entrypoint.sh"),
    nodeModules: join(local, "dev", "node_modules"),
    devTemp,
    home: join(devTemp, "home"),
    tmp: join(temp, "tmp"),
    bunCache: join(local, "cache", "bun"),
  };
}
