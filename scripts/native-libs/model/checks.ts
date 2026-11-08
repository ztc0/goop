import type { ToolchainPackage } from "@scripts/native-libs/types/native-libs";

/** Reads `dpkg-query` lines (`name version`) and names every package that differs from its pin. */
export function checkToolchain(expected: readonly ToolchainPackage[], listed: string): string[] {
  const installed = new Map(
    listed
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => {
        const [name = "", version = ""] = line.trim().split(/\s+/);
        return [name, version] as const;
      }),
  );
  return expected.flatMap(({ name, version }) => {
    const found = installed.get(name);
    if (found === undefined) return [`${name} is not installed, expected ${version}`];
    return found === version ? [] : [`${name} is ${found}, expected ${version}`];
  });
}

/** The sha256 a `sha256sum` list gives `name` (text or `*` binary mode), if it lists it. */
export function listedSha256(list: string, name: string): string | undefined {
  for (const line of list.split("\n")) {
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trimEnd());
    if (match?.[2] === name) return match[1];
  }
  return undefined;
}
