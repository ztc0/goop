import { join } from "node:path";
import { sandboxPaths } from "../../sandbox/model/paths";
import type { NativePaths } from "../types/native-build";
import { LINUX_LIBRARY } from "./manifest";

/** Every path the native build uses, from the repo root: nothing lives outside it. */
export function nativePaths(root: string): NativePaths {
  const sandbox = sandboxPaths(root);
  const output = join(root, ".local", "build", "native");
  const temp = join(root, ".temp");
  return {
    root,
    containerfile: join(root, "scripts", "native", "linux", "Containerfile"),
    containerDirectories: [
      sandbox.containerStorage,
      sandbox.containerRunRoot,
      sandbox.containerTmp,
    ],
    output,
    library: join(output, "linux-x64", LINUX_LIBRARY),
    manifest: join(output, "manifest.json"),
    downloads: join(temp, "downloads"),
    extract: join(temp, "extract"),
    staging: join(temp, "tmp"),
  };
}
