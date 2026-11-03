import { isAbsolute, relative, resolve } from "node:path";

/**
 * Base files a run needs as writable copies (UEFI vars, markers). The disk is reached
 * through the overlay instead, and the installer ISO is not needed after the install.
 */
export function baseFilesToCopy(names: string[]): string[] {
  return names.filter((name) => name !== "data.qcow2" && !/\.iso$/i.test(name)).sort();
}

/** The absolute path of a repo path to upload, or undefined for the root or outside it. */
export function resolveCopyPath(root: string, path: string): string | undefined {
  const absolute = resolve(root, path);
  const inside = relative(root, absolute);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) return undefined;
  return absolute;
}

export function formatBytes(bytes: number): string {
  const units = ["KiB", "MiB", "GiB", "TiB"];
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
