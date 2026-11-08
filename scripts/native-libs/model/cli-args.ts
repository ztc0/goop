import type { EngineName } from "../../shared/containers";

export type BuildCommand =
  | { kind: "build"; libraries: string[]; engine?: EngineName; verifySignature: boolean }
  | { kind: "help" }
  | { kind: "usage"; error: string };

export const USAGE = `Usage: bun run native-libs:build [<library>...] [--engine podman|docker] [--verify-signature]

Downloads each pinned native library's source, checks its sha256, builds it in a fresh
container without network and checks the output against its pinned sha256. Only then it
writes .local/build/native/<platform>/<file> and .local/build/native/manifest.json.

Libraries (by default, all of them):
  sqlite3mc           SQLite3MultipleCiphers 2.6.1, for linux-x64

Options:
  --engine <engine>   podman or docker; by default Podman if installed, else Docker
  --verify-signature  First check the Cosign signature of the release's checksum list;
                      it needs Rekor, the Sigstore transparency log
  -h, --help          Show this help
`;

const ENGINES: readonly string[] = ["podman", "docker"] satisfies EngineName[];

/** The command line: library names, `--engine <engine>` and `--verify-signature`. */
export function parseBuildArgs(argv: string[], known: readonly string[]): BuildCommand {
  const libraries: string[] = [];
  let engine: EngineName | undefined;
  let verifySignature = false;
  const usage = (error: string): BuildCommand => ({ kind: "usage", error });
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "-h" || arg === "--help") return { kind: "help" };
    if (arg === "--verify-signature") {
      if (verifySignature) return usage("--verify-signature is given more than once.");
      verifySignature = true;
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
  return engine === undefined
    ? { kind: "build", libraries: chosen, verifySignature }
    : { kind: "build", libraries: chosen, engine, verifySignature };
}
