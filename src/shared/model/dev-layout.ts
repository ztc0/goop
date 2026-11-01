import { join } from "node:path";

/** Persistent development environment: config, data, caches and models (S25). */
export interface LocalLayout {
  root: string;
  config: string;
  data: string;
  state: string;
  cache: string;
  bunCache: string;
  uvCache: string;
  hfCache: string;
  models: string;
  bin: string;
  build: string;
}

/** Disposable files: deleting this folder never loses anything (S26). */
export interface TempLayout {
  root: string;
  tmp: string;
  tests: string;
  downloads: string;
  extract: string;
  scratch: string;
  run: string;
}

export interface DevLayout {
  local: LocalLayout;
  temp: TempLayout;
}

/** Where development keeps everything inside the repo, so the machine stays clean. */
export function devLayout(repoRoot: string): DevLayout {
  const local = join(repoRoot, ".local");
  const cache = join(local, "cache");
  const temp = join(repoRoot, ".temp");
  return {
    local: {
      root: local,
      config: join(local, "config"),
      data: join(local, "data"),
      state: join(local, "state"),
      cache,
      bunCache: join(cache, "bun"),
      uvCache: join(cache, "uv"),
      hfCache: join(cache, "hf"),
      models: join(local, "models"),
      bin: join(local, "bin"),
      build: join(local, "build"),
    },
    temp: {
      root: temp,
      tmp: join(temp, "tmp"),
      tests: join(temp, "tests"),
      downloads: join(temp, "downloads"),
      extract: join(temp, "extract"),
      scratch: join(temp, "scratch"),
      run: join(temp, "run"),
    },
  };
}

/** Variables that point goop and the tools it runs at the repo-local layout. */
export function devEnvironment(layout: DevLayout): Record<string, string> {
  return {
    GOOP_HOME: layout.local.root,
    GOOP_RUNTIME_DIR: layout.temp.run,
    BUN_INSTALL_CACHE_DIR: layout.local.bunCache,
    UV_CACHE_DIR: layout.local.uvCache,
    HF_HOME: layout.local.hfCache,
    TMPDIR: layout.temp.tmp,
    TMP: layout.temp.tmp,
    TEMP: layout.temp.tmp,
  };
}

/** Every directory of the layout, for creating it before a command runs. */
export function layoutDirectories(layout: DevLayout): string[] {
  return [...Object.values(layout.local), ...Object.values(layout.temp)];
}
