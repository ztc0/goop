import { PLATFORMS } from "@scripts/native-libs/model/manifest";
import type { NativePlatform } from "@scripts/native-libs/types/native-libs";
import type { EngineName } from "@scripts/shared/containers";

export type BuildCommand =
  | {
      kind: "build";
      libraries: string[];
      target?: NativePlatform;
      engine?: EngineName;
      verifySignature: boolean;
    }
  | { kind: "help" }
  | { kind: "usage"; error: string };

export const USAGE = `Usage: bun run native-libs:build [<library>...] [--target linux-x64|win32-x64] [--engine podman|docker] [--verify-signature]

Downloads each pinned native library's source, checks its sha256, builds it for each target
in a fresh container without network and checks every output against its pinned sha256. Only
then it writes .local/build/native/<platform>/<file> and .local/build/native/manifest.json.

Libraries (by default, all of them):
  sqlite3mc           SQLite3MultipleCiphers 2.6.1, for linux-x64 and win32-x64

Options:
  --target <platform> linux-x64 or win32-x64; by default every target of each library
  --engine <engine>   podman or docker; by default Podman if installed, else Docker
  --verify-signature  First check the Cosign signature of the release's checksum list;
                      it needs Rekor, the Sigstore transparency log
  -h, --help          Show this help
`;

const ENGINES: readonly string[] = ["podman", "docker"] satisfies EngineName[];

/** The command line: library names, `--target`, `--engine` and `--verify-signature`. */
export function parseBuildArgs(argv: string[], known: readonly string[]): BuildCommand {
  const libraries: string[] = [];
  let target: NativePlatform | undefined;
  let engine: EngineName | undefined;
  let verifySignature = false;
  const usage = (error: string): BuildCommand => ({ kind: "usage", error });
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "-h" || arg === "--help") return { kind: "help" };
    if (arg === "--verify-signature") {
      if (verifySignature) return usage("--verify-signature is given more than once.");
      verifySignature = true;
    } else if (arg === "--target") {
      const value = argv[index + 1];
      index += 1;
      if (value === undefined) return usage("--target needs a value.");
      if (!PLATFORMS.includes(value)) {
        return usage(`Unknown --target: ${value} (expected ${PLATFORMS.join(" or ")}).`);
      }
      if (target !== undefined) return usage("--target is given more than once.");
      target = value as NativePlatform;
    } else if (arg === "--engine") {
      const value = argv[index + 1];
      index += 1;
      if (value === undefined) return usage("--engine needs a value.");
      if (!ENGINES.includes(value)) {
        return usage(`Unknown --engine: ${value} (expected podman or docker).`);
      }
      if (engine !== undefined) return usage("--engine is given more than once.");
      engine = value as EngineName;
    } else if (arg.startsWith("-")) {
      return usage(`Unknown option: ${arg}`);
    } else if (!known.includes(arg)) {
      return usage(`Unknown library: ${arg} (expected ${known.join(", ")}).`);
    } else if (libraries.includes(arg)) {
      return usage(`${arg} is given more than once.`);
    } else {
      libraries.push(arg);
    }
  }
  const chosen = libraries.length > 0 ? libraries : [...known];
  return {
    kind: "build",
    libraries: chosen,
    ...(target === undefined ? {} : { target }),
    ...(engine === undefined ? {} : { engine }),
    verifySignature,
  };
}
