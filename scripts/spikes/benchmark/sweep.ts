// T13 spike: the benchmark sweep. Every flag was checked against `llama-server --help` at v0.8.0.
import type { BenchConfig } from "./lib";

const QWEN = "qwen3.5-9b-mtp-q4_k_m";
const GPT_OSS = "gpt-oss-20b-mxfp4";
const EAGLE3 = "gpt-oss-20b-eagle3-q8_0";

const qwenGpu = ["--device", "Vulkan1", "-ngl", "99", "-c", "8192", "-fa", "on"];
const ossCpu = ["--device", "none", "-ngl", "0", "-c", "8192"];
// gpt-oss-20b has 24 layers; 24 keeps every expert on the CPU, 16 puts the experts of 8 layers
// (about 4 GB of MXFP4) on the 8 GB RX 7700S. Both values are a guess until the sweep runs.
const ossGpu = (cpuMoe: number) => [...qwenGpu, "--n-cpu-moe", `${cpuMoe}`];
const sampling = (topK: number) => ({ temperature: 1.0, top_k: topK, ignore_eos: true });

export const SWEEP: readonly BenchConfig[] = [
  { label: "qwen-base", model: QWEN, flags: qwenGpu },
  { label: "qwen-kv-q8", model: QWEN, flags: [...qwenGpu, "-ctk", "q8_0", "-ctv", "q8_0"] },
  { label: "qwen-ub2048", model: QWEN, flags: [...qwenGpu, "-b", "2048", "-ub", "2048"] },
  {
    label: "qwen-mtp2",
    model: QWEN,
    flags: [...qwenGpu, "--spec-type", "draft-mtp", "--spec-draft-n-max", "2"],
  },
  {
    label: "qwen-mtp3",
    model: QWEN,
    flags: [...qwenGpu, "--spec-type", "draft-mtp", "--spec-draft-n-max", "3"],
  },
  { label: "qwen-ngram-mod", model: QWEN, flags: [...qwenGpu, "--spec-type", "ngram-mod"] },
  { label: "oss-cpu-t8", model: GPT_OSS, flags: [...ossCpu, "-t", "8"] },
  { label: "oss-cpu-t16", model: GPT_OSS, flags: [...ossCpu, "-t", "16"] },
  { label: "oss-gpu-moe24", model: GPT_OSS, flags: ossGpu(24) },
  { label: "oss-gpu-moe16", model: GPT_OSS, flags: ossGpu(16) },
  {
    label: "oss-eagle3",
    model: GPT_OSS,
    draft: EAGLE3,
    flags: [...ossGpu(16), "--spec-type", "draft-eagle3", "-devd", "Vulkan1", "-ngld", "99"],
  },
  { label: "oss-ngram-mod", model: GPT_OSS, flags: [...ossGpu(16), "--spec-type", "ngram-mod"] },
  // top_k is a request field: temperature 1 with a fixed length, top_k 100 against 0 (disabled).
  { label: "oss-topk100", model: GPT_OSS, flags: ossGpu(16), request: sampling(100) },
  { label: "oss-topk0", model: GPT_OSS, flags: ossGpu(16), request: sampling(0) },
];
