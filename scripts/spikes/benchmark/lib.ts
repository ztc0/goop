// T13 spike: pure helpers of the benchmark harness (argv, environment, statistics, metrics).

export interface BenchConfig {
  label: string;
  /** Model id from models.ts. */
  model: string;
  /** Model id of the draft model, passed with -md. */
  draft?: string;
  /** Per-config server flags; must include -c, and -ngl unless `fit` is set. */
  flags: string[];
  /** Let --fit choose -ngl and the CPU/GPU split instead of the config. */
  fit?: boolean;
  /** Fields merged into every /completion request (sampling checks). */
  request?: Record<string, unknown>;
}

export interface Summary {
  median: number;
  min: number;
  max: number;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median of an empty list");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export function summarize(values: readonly number[]): Summary {
  return { median: median(values), min: Math.min(...values), max: Math.max(...values) };
}

/** Unlabeled Prometheus samples by name, without the `llamacpp:` prefix. */
export function parseMetrics(text: string): Record<string, number> {
  const metrics: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const match = /^(?:llamacpp:)?([A-Za-z_][\w]*) (\S+)$/.exec(line.trim());
    if (match) metrics[match[1] as string] = Number(match[2]);
  }
  return metrics;
}

/** Accepted / drafted tokens between two /metrics scrapes; null when nothing was drafted. */
export function acceptanceRate(
  before: Record<string, number>,
  after: Record<string, number>,
): number | null {
  const delta = (name: string) => (after[name] ?? 0) - (before[name] ?? 0);
  const drafted = delta("spec_decode_num_draft_tokens_total");
  return drafted > 0 ? delta("spec_decode_num_accepted_tokens_total") / drafted : null;
}

export function filterConfigs<T extends { label: string }>(
  configs: readonly T[],
  only: readonly string[] | undefined,
): T[] {
  if (!only) return [...configs];
  const unknown = only.filter((label) => !configs.some((config) => config.label === label));
  if (unknown.length > 0) throw new Error(`unknown config label: ${unknown.join(", ")}`);
  return configs.filter((config) => only.includes(config.label));
}

export function parseCli(args: readonly string[]): { list: boolean; only: string[] | undefined } {
  let list = false;
  let only: string[] | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--list") list = true;
    else if (arg === "--only") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("--only needs <label,...>");
      only = value.split(",").filter(Boolean);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return { list, only };
}

export interface ArgvInput {
  server: string;
  model: string;
  draft?: string;
  port: number;
  apiKeyFile: string;
  flags: readonly string[];
  fit?: boolean;
}

/** Hardened flags first (S24), then the config flags. The API key stays in its file. */
export function buildArgv(input: ArgvInput): string[] {
  for (const flag of input.fit ? ["-c"] : ["-c", "-ngl"]) {
    if (!input.flags.includes(flag)) throw new Error(`config needs an explicit ${flag}`);
  }
  return [
    input.server,
    ...["-m", input.model, "--host", "127.0.0.1", "--port", String(input.port)],
    ...["--no-webui", "--offline", "--no-slots", "--metrics", "-np", "1"],
    ...["--api-key-file", input.apiKeyFile, "--fit", input.fit ? "on" : "off"],
    ...input.flags,
    ...(input.draft ? ["-md", input.draft] : []),
  ];
}

/** Only PATH, HOME and LANG, plus an empty config folder, so no config.ini or LLAMA_ARG_* applies. */
export function cleanEnv(
  source: Record<string, string | undefined>,
  configDir: string,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ["PATH", "HOME", "LANG"]) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  env.XDG_CONFIG_HOME = configDir;
  return env;
}
