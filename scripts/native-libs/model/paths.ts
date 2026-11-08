import { join } from "node:path";
import type { NativeLibsPaths } from "@scripts/native-libs/types/native-libs";

/**
 * Every path the build uses, from the repo root: nothing lives outside it. Podman's storage is
 * the same folders the sandbox uses, so the pinned Debian base is pulled once.
 */
export function nativeLibsPaths(root: string): NativeLibsPaths {
  const local = join(root, ".local");
  const temp = join(root, ".temp");
  const output = join(local, "build", "native");
  return {
    root,
    output,
    manifest: join(output, "manifest.json"),
    downloads: join(temp, "downloads"),
    extract: join(temp, "extract"),
    staging: join(temp, "tmp"),
    podman: {
      containerStorage: join(local, "containers", "storage"),
      containerRunRoot: join(temp, "containers", "run"),
      containerTmp: join(temp, "containers", "tmp"),
    },
  };
}
