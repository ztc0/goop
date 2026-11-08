import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { devEnvironment, devLayout } from "@/shared/dev/model/dev-layout";

const root = join("/", "work", "goop");

describe("devLayout", () => {
  test("keeps every persistent path under .local and every disposable path under .temp", () => {
    const layout = devLayout(root);

    expect(layout.local).toEqual({
      root: join(root, ".local"),
      config: join(root, ".local", "config"),
      data: join(root, ".local", "data"),
      state: join(root, ".local", "state"),
      cache: join(root, ".local", "cache"),
      bunCache: join(root, ".local", "cache", "bun"),
      uvCache: join(root, ".local", "cache", "uv"),
      hfCache: join(root, ".local", "cache", "hf"),
      models: join(root, ".local", "models"),
      bin: join(root, ".local", "bin"),
      build: join(root, ".local", "build"),
    });
    expect(layout.temp).toEqual({
      root: join(root, ".temp"),
      tmp: join(root, ".temp", "tmp"),
      tests: join(root, ".temp", "tests"),
      downloads: join(root, ".temp", "downloads"),
      extract: join(root, ".temp", "extract"),
      scratch: join(root, ".temp", "scratch"),
      run: join(root, ".temp", "run"),
    });
  });
});

describe("devEnvironment", () => {
  test("points goop, the tool caches and the temp directory into the repo", () => {
    expect(devEnvironment(devLayout(root))).toEqual({
      GOOP_HOME: join(root, ".local"),
      GOOP_RUNTIME_DIR: join(root, ".temp", "run"),
      BUN_INSTALL_CACHE_DIR: join(root, ".local", "cache", "bun"),
      UV_CACHE_DIR: join(root, ".local", "cache", "uv"),
      HF_HOME: join(root, ".local", "cache", "hf"),
      TMPDIR: join(root, ".temp", "tmp"),
      TMP: join(root, ".temp", "tmp"),
      TEMP: join(root, ".temp", "tmp"),
    });
  });
});
