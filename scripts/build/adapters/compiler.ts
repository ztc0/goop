import type { Compiler } from "@scripts/build/types/build";

const exact = (path: string) => new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

/**
 * `bun build --compile` through `Bun.build`. Each embedded file keeps its plain name in
 * `Bun.embeddedFiles` (`[name].[ext]`), and a plugin gives only those files the `file` loader,
 * so the manifest is embedded as bytes while any JSON goop imports is still bundled as code.
 * Bun's executable would also load the `.env` and `bunfig.toml` of the folder it starts in,
 * letting any folder change goop's settings or run code: both are off (dev-sandbox S11).
 */
export const bunCompiler: Compiler = {
  async compile({ entry, outfile, files }) {
    const result = await Bun.build({
      entrypoints: [entry, ...files],
      compile: { outfile, autoloadDotenv: false, autoloadBunfig: false },
      naming: { asset: "[name].[ext]" },
      throw: false,
      plugins: [
        {
          name: "goop-embedded-files",
          setup(build) {
            for (const file of files) {
              build.onLoad({ filter: exact(file) }, async () => ({
                contents: await Bun.file(file).bytes(),
                loader: "file",
              }));
            }
          },
        },
      ],
    });
    const [output] = result.outputs;
    if (!result.success || !output) {
      return { ok: false, error: result.logs.map((log) => String(log)).join("\n") };
    }
    return { ok: true, path: output.path };
  },
};
