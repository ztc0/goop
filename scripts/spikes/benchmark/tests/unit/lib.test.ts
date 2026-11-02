import { describe, expect, test } from "bun:test";
import {
  acceptanceRate,
  buildArgv,
  cleanEnv,
  filterConfigs,
  median,
  parseCli,
  parseMetrics,
  summarize,
} from "../../lib";
import { SWEEP } from "../../sweep";

describe("median and summarize", () => {
  test("median of odd and even lists, without reordering the input", () => {
    const values = [3, 1, 2];
    expect(median(values)).toBe(2);
    expect(values).toEqual([3, 1, 2]);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  test("median of an empty list is an error", () => {
    expect(() => median([])).toThrow("median of an empty list");
  });

  test("summarize gives median, min and max", () => {
    expect(summarize([10, 30, 20])).toEqual({ median: 20, min: 10, max: 30 });
  });
});

describe("parseMetrics", () => {
  const text = [
    "# HELP llamacpp:prompt_tokens_total Number of prompt tokens processed.",
    "# TYPE llamacpp:prompt_tokens_total counter",
    "llamacpp:prompt_tokens_total 1530",
    "llamacpp:spec_decode_num_draft_tokens_total 200",
    "llamacpp:spec_decode_num_accepted_tokens_total 150",
    'llamacpp:spec_decode_num_accepted_tokens_per_pos_total{position="0"} 90',
    "llamacpp:n_busy_slots_per_decode 1.5e+00",
    "",
  ].join("\n");

  test("reads unlabeled samples without the llamacpp: prefix and skips comments and labels", () => {
    expect(parseMetrics(text)).toEqual({
      prompt_tokens_total: 1530,
      spec_decode_num_draft_tokens_total: 200,
      spec_decode_num_accepted_tokens_total: 150,
      n_busy_slots_per_decode: 1.5,
    });
  });

  test("acceptance rate is accepted / drafted between two scrapes", () => {
    const before = parseMetrics(text);
    const after = {
      ...before,
      spec_decode_num_draft_tokens_total: 300,
      spec_decode_num_accepted_tokens_total: 225,
    };
    expect(acceptanceRate(before, after)).toBe(0.75);
  });

  test("acceptance rate is null when nothing was drafted or the counters are missing", () => {
    const before = parseMetrics(text);
    expect(acceptanceRate(before, before)).toBeNull();
    expect(acceptanceRate({}, {})).toBeNull();
  });
});

describe("filterConfigs", () => {
  const configs = [
    { label: "a", model: "m", flags: [] },
    { label: "b", model: "m", flags: [] },
    { label: "c", model: "m", flags: [] },
  ];

  test("no filter keeps every config in table order", () => {
    expect(filterConfigs(configs, undefined).map((c) => c.label)).toEqual(["a", "b", "c"]);
  });

  test("--only keeps the named configs in table order", () => {
    expect(filterConfigs(configs, ["c", "a"]).map((c) => c.label)).toEqual(["a", "c"]);
  });

  test("an unknown label is an error naming it", () => {
    expect(() => filterConfigs(configs, ["a", "zz"])).toThrow("unknown config label: zz");
  });
});

describe("parseCli", () => {
  test("no arguments runs everything", () => {
    expect(parseCli([])).toEqual({ list: false, only: undefined });
  });

  test("--list and --only <a,b>", () => {
    expect(parseCli(["--list"])).toEqual({ list: true, only: undefined });
    expect(parseCli(["--only", "a,b"])).toEqual({ list: false, only: ["a", "b"] });
  });

  test("--only without labels and unknown arguments are errors", () => {
    expect(() => parseCli(["--only"])).toThrow("--only needs <label,...>");
    expect(() => parseCli(["--fast"])).toThrow("unknown argument: --fast");
  });
});

describe("buildArgv", () => {
  const base = {
    server: "/srv/llama-server",
    model: "/models/m.gguf",
    port: 4242,
    apiKeyFile: "/scratch/key",
  };

  test("puts the hardened flags first, then the config flags", () => {
    expect(buildArgv({ ...base, flags: ["-ngl", "99", "-c", "8192", "-fa", "on"] })).toEqual([
      "/srv/llama-server",
      "-m",
      "/models/m.gguf",
      "--host",
      "127.0.0.1",
      "--port",
      "4242",
      "--no-webui",
      "--offline",
      "--no-slots",
      "--metrics",
      "-np",
      "1",
      "--api-key-file",
      "/scratch/key",
      "--fit",
      "off",
      "-ngl",
      "99",
      "-c",
      "8192",
      "-fa",
      "on",
    ]);
  });

  test("adds the draft model with -md when there is one", () => {
    const argv = buildArgv({ ...base, draft: "/models/d.gguf", flags: ["-ngl", "0", "-c", "1"] });
    expect(argv.slice(-6)).toEqual(["-ngl", "0", "-c", "1", "-md", "/models/d.gguf"]);
  });

  test("refuses flags without an explicit -c or -ngl, because --fit is off", () => {
    expect(() => buildArgv({ ...base, flags: ["-ngl", "99"] })).toThrow("needs an explicit -c");
    expect(() => buildArgv({ ...base, flags: ["-c", "8192"] })).toThrow("needs an explicit -ngl");
  });
});

describe("cleanEnv", () => {
  test("keeps only PATH, HOME and LANG and sets XDG_CONFIG_HOME", () => {
    const source = {
      PATH: "/usr/bin",
      HOME: "/home/u",
      LANG: "C.UTF-8",
      LLAMA_ARG_THREADS: "4",
      LLAMA_ARG_TOOLS: "all",
      XDG_CONFIG_HOME: "/home/u/.config",
      GOOP_HOME: "/repo/.local",
    };
    expect(cleanEnv(source, "/repo/.temp/scratch/benchmark/config/x")).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/u",
      LANG: "C.UTF-8",
      XDG_CONFIG_HOME: "/repo/.temp/scratch/benchmark/config/x",
    });
  });

  test("leaves out a variable that is not set", () => {
    expect(cleanEnv({ PATH: "/bin" }, "/c")).toEqual({ PATH: "/bin", XDG_CONFIG_HOME: "/c" });
  });
});

describe("SWEEP", () => {
  test("labels are unique and every config builds a valid argv", () => {
    const labels = SWEEP.map((config) => config.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const config of SWEEP) {
      expect(() => buildArgv({ ...base(), flags: config.flags })).not.toThrow();
    }
  });
});

function base() {
  return { server: "/s", model: "/m", port: 1, apiKeyFile: "/k" };
}
