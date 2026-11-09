import type { Output } from "@scripts/shared/containers";
import type { BuiltNativeLibraryOptions, NativePlatform } from "@/shared/vault";

/** What one `bun run build` compiles, from the repo root. */
export interface BuildRequest {
  root: string;
  /** The host's platform: the executable embeds this platform's libraries. */
  platform: NativePlatform;
  entry: string;
  outfile: string;
}

/** One `bun build --compile`; each of `files` is embedded as a file, never bundled as code. */
export interface CompileRequest {
  entry: string;
  outfile: string;
  files: string[];
}

export type CompileResult = { ok: true; path: string } | { ok: false; error: string };

export interface Compiler {
  compile(request: CompileRequest): Promise<CompileResult>;
}

export interface BuildDeps {
  /** `builtNativeLibrary`: the library's path once its sha256 matched the manifest. */
  verify(options: BuiltNativeLibraryOptions): Promise<string>;
  compiler: Compiler;
  output: Output;
}
