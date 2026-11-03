# Spike: benchmark sweep on the user's PC (T13)

Date: 2026-11-02. Task T13 in [`odd/tasks/goop.md`](../../odd/tasks/goop.md), spec S23. The sweep ran on the user's PC with the T12 llama-server build through a harness in `scripts/spikes/benchmark/`. This note is the spike's proposal; the user decides the S23 settings in T18.

## Question

Which llama-server settings give the best speed for Qwen 3.5 9B and gpt-oss-20b on the user's PC, and which of the S23 drafts (MTP, EAGLE3, ngram-mod) earn their place?

## Short answer

Qwen 3.5 9B on the RX 7700S with MTP drafting (`--spec-draft-n-max 3`) generates JSON at 83 t/s, about 2.1x the 40 t/s base; KV q8_0 costs no speed. For gpt-oss-20b, `--fit on` beats the hand-picked expert split (31.7 against 25.2 t/s) and CPU-only (19.5 t/s). EAGLE3 and ngram-mod give no general gain. Two full passes agree within about 1% for every config.

One finding changes how S23 reads: gpt-oss is 1.6x faster on the free GPU than on the CPU, but Qwen and gpt-oss together do not fit in 8 GB, so "gpt-oss on CPU" holds only when both run at once.

## Findings

1. **The first sweep was discarded.** It repeated the same prompt 3 times. ngram-mod remembers earlier answers across requests, so Qwen ngram-mod showed 332 t/s with 100% acceptance on output identical to the base: a measurement artifact. Commit `639e8fb` gives every run a different prompt and records the power state and a 400-character sample of the answer. The old file stays in `.local/benchmark/results-2026-11-02-repeated-prompts.jsonl`, not in git.
2. **Qwen base was slower once, for an unknown reason.** In the discarded sweep and the first smoke run, Qwen base gave pp 444 and tg 26.9 t/s; later runs gave pp about 790 and tg 40. The power state looked the same (on mains power, `balanced`). The cause was not found.
3. **MTP doubles Qwen on JSON.** `qwen-mtp3` reaches 83.6 t/s on the offer with 0.96 acceptance; `qwen-mtp2` reaches 75.5. On short answers acceptance drops (0.58 and 0.68), and n-max 2 is ahead (60.3 against 57.4 t/s).
4. **Speculative output is not byte-identical at temperature 0.** The `qwen-mtp3` short answer differs from `qwen-base` at character 97 ("perfection" against "completeness"); the `oss-eagle3` offer answer differs from `oss-gpu-moe16` at character 245. The `qwen-mtp3` offer answer equals the base. The likely cause is numeric differences of batched verification. Output quality must be judged by the eval set (T28), not assumed equal.
5. **`--fit on` places more experts than the hand-picked split.** It logs nothing about its choice at the default verbosity, only "tensor overrides to CPU are used with mmap enabled - consider using --load-mode none". Its peak VRAM (7119 MiB against 4950) shows that it put more experts on the GPU.
6. **The `--n-cpu-moe` values were guesses.** 24 and 16 were not measured choices; `moe24` kept every expert on the CPU (1708 MiB VRAM).
7. **gpt-oss does not answer the raw prompt with JSON.** On `/completion` without a chat template it writes its reasoning ("We need to parse job offer...") instead of JSON. Its speeds are valid, its content is not representative. Qwen produced JSON.
8. **top_k 100 costs no speed.** With temperature 1 and a fixed length, top_k 100 is slightly faster than top_k 0 (disabled): 25.2 against 24.2 t/s.

## Environment

| Item          | Value                                                                               |
| ------------- | ----------------------------------------------------------------------------------- |
| CPU           | AMD Ryzen 9 7940HS, 8 cores, 16 threads                                             |
| RAM           | 30 GB                                                                               |
| GPU used      | AMD Radeon RX 7700S 8 GB, `Vulkan1` (RADV NAVI33)                                   |
| GPU not used  | AMD Radeon 780M iGPU, `Vulkan0`                                                     |
| System        | Arch Linux                                                                          |
| Power         | Mains power, platform profile `balanced`, GPU dpm `auto` (recorded in every result) |
| llama-server  | `v0.8.0`, commit `8642541`, T12 build from run `41379281254`                        |
| Spike commits | `b9138d1`, `10ef2c1`, `4130e09`, `639e8fb`                                          |

## Models

All 3 files (18 GB) matched their pinned sha256 after download.

| Id                        | Repository                    | Commit                                     | File                           | Bytes          | sha256                                                             |
| ------------------------- | ----------------------------- | ------------------------------------------ | ------------------------------ | -------------- | ------------------------------------------------------------------ |
| `qwen3.5-9b-mtp-q4_k_m`   | `unsloth/Qwen3.5-9B-MTP-GGUF` | `9716a636ee4bddc3fed678220b7a33dd2a4160ae` | `Qwen3.5-9B-Q4_K_M.gguf`       | 5,868,826,976  | `e8dd94817e95d6c0939102049d068418269978377b13616c4726235e232841fe` |
| `gpt-oss-20b-mxfp4`       | `ggml-org/gpt-oss-20b-GGUF`   | `15dcfc7e7c608c6161507211ed43c5b590801b4b` | `gpt-oss-20b-MXFP4.gguf`       | 12,109,566,624 | `27cd6c432c7672cb812a92f611cf3ba7bbc35928262bb1e1253ff4ee6ae35901` |
| `gpt-oss-20b-eagle3-q8_0` | `ggml-org/gpt-oss-20b-GGUF`   | `15dcfc7e7c608c6161507211ed43c5b590801b4b` | `eagle3-gpt-oss-20b-Q8_0.gguf` | 921,488,000    | `6955f98a701e97a8c969f3ff33be8ba17b35bd60e5ac96258d2c42d710c7d63f` |

## Method

- **One server per config.** `bench.ts` starts a fresh llama-server for each config of `sweep.ts` and stops it before the next.
- **Clean environment.** The child gets only `PATH`, `HOME` and `LANG` plus an empty `XDG_CONFIG_HOME`: no `config.ini` and no `LLAMA_ARG_*` (T12 finding 6). The harness aborts if `/etc/llama.cpp/config.ini` exists.
- **Hardened flags.** Every server gets `--host 127.0.0.1 --no-webui --offline --no-slots --metrics -np 1 --api-key-file <0600 file> --fit off` with an explicit `-c 8192` and `-ngl`. `oss-fit` uses `--fit on` and no `-ngl`.
- **Prompts.** "offer" asks for JSON extracted from a synthetic job offer of about 1210 tokens (3 fictional companies); "short" asks 3 different short questions.
- **Runs.** Requests go to `/completion` with `n_predict` 256, temperature 0, `cache_prompt` false and seed 42. One warm-up prompt, then 3 measured runs per prompt kind, each with a different prompt. Medians are reported.
- **What is measured.** Prompt and generation speed from the response timings, draft acceptance from the `spec_decode` counters of `/metrics`, and peak VRAM from the RX 7700S `mem_info_vram_used` in sysfs, sampled every 200 ms.

```mermaid
flowchart LR
    Config[Config from sweep.ts] --> Start[Start llama-server, clean env]
    Start --> Health[Wait for /health]
    Health --> Warm[Warm-up prompt]
    Warm --> Offer[3 offer prompts]
    Offer --> Short[3 short prompts]
    Short --> Record[Medians, acceptance, peak VRAM, power state]
    Record --> Stop[Stop server]
    Stop --> Config
```

## How to run

The harness was removed from the repository after the spike and can be read in git history at commit `03507e4`, path `scripts/spikes/benchmark/`, for example `git show 03507e4:scripts/spikes/benchmark/sweep.ts`. The commands below ran against it.

The harness expects the T12 Linux build unpacked under `.local/build/llama-server/run-41379281254/linux/`.

```sh
# Download the pinned models into .local/models/ and check their sha256
bun scripts/dev-env/run.ts bun scripts/spikes/benchmark/download.ts

# List the configs, then run all of them or a subset
bun scripts/dev-env/run.ts bun scripts/spikes/benchmark/bench.ts --list
bun scripts/dev-env/run.ts bun scripts/spikes/benchmark/bench.ts
bun scripts/dev-env/run.ts bun scripts/spikes/benchmark/bench.ts --only qwen-base,qwen-mtp3
```

Each run appends one JSON line per config to `.local/benchmark/results-<date>.jsonl` and prints a table.

## Results

pp = prompt t/s on the offer, tg = generation t/s on the offer, short = generation t/s on the short questions, acc = draft acceptance on the offer (short in brackets), VRAM = peak MiB. Each cell is pass 1 / pass 2. `-` means not recorded or not applicable.

| Config           | Settings                                            | pp        | tg          | short       | acc         | VRAM |
| ---------------- | --------------------------------------------------- | --------- | ----------- | ----------- | ----------- | ---- |
| `qwen-base`      | GPU, `-ngl 99 -fa on`                               | 790 / 790 | 40.0 / 40.0 | 40.4 / 40.3 | -           | 5391 |
| `qwen-kv-q8`     | base + `-ctk q8_0 -ctv q8_0`                        | 782 / 783 | 39.7 / 39.7 | 40.0 / 39.9 | -           | 5271 |
| `qwen-ub2048`    | base + `-b 2048 -ub 2048`                           | 750 / 752 | 39.9 / 40.0 | 40.3 / 40.4 | -           | 5759 |
| `qwen-mtp2`      | base + `draft-mtp`, n-max 2                         | 732 / 736 | 75.5 / 75.1 | 60.3 / 60.3 | 0.97 (0.68) | 5786 |
| `qwen-mtp3`      | base + `draft-mtp`, n-max 3                         | 731 / 731 | 83.6 / 83.3 | 57.4 / 57.7 | 0.96 (0.58) | 5836 |
| `qwen-ngram-mod` | base + `ngram-mod`                                  | 784 / 779 | 37.2 / 39.1 | 40.2 / 40.3 | 0.05        | 5391 |
| `oss-cpu-t8`     | CPU only, `-t 8`                                    | 96 / 96   | 19.5 / 19.5 | 21.2 / 21.3 | -           | 26   |
| `oss-cpu-t16`    | CPU only, `-t 16`                                   | 93 / 92   | 18.4 / 18.4 | 19.9 / 19.9 | -           | 26   |
| `oss-gpu-moe24`  | GPU, `--n-cpu-moe 24`                               | 244 / 245 | 26.3 / 26.2 | 26.4 / 26.4 | -           | 1708 |
| `oss-gpu-moe16`  | GPU, `--n-cpu-moe 16`                               | 310 / 311 | 25.2 / 25.2 | 25.5 / 25.5 | -           | 4950 |
| `oss-fit`        | GPU, `--fit on`                                     | 476 / 471 | 31.7 / 31.7 | 31.9 / 31.9 | -           | 7119 |
| `oss-eagle3`     | moe16 + EAGLE3 draft                                | 299 / 303 | 29.6 / 29.4 | 21.4 / 21.4 | 0.46 (0.28) | 6071 |
| `oss-ngram-mod`  | moe16 + `ngram-mod`                                 | 312 / 312 | 25.2 / 25.2 | 26.8 / 27.0 | 0.23        | 4951 |
| `oss-topk100`    | moe16, temperature 1, `top_k` 100, `ignore_eos`     | 311 / 309 | 25.2 / 25.2 | 25.5 / 25.7 | -           | 4950 |
| `oss-topk0`      | moe16, temperature 1, `top_k` 0 (off), `ignore_eos` | 312 / 311 | 24.2 / 24.2 | 24.1 / 24.2 | -           | 4950 |

## Recommendations for S23

### Qwen 3.5 9B on the RX 7700S

- **Use MTP for JSON roles.** `--device Vulkan1 -ngl 99 -c 8192 -fa on -ctk q8_0 -ctv q8_0 --spec-type draft-mtp --spec-draft-n-max 3`: 83 t/s on the offer, about 2.1x the base.
- **Use n-max 2 for free text.** It is ahead on short answers (60 against 58 t/s).
- **Keep KV q8_0.** It costs no speed and saves about 120 MiB.
- **Keep ubatch 512.** 2048 is slower and uses more VRAM.
- **Drop ngram-mod.** It gives no gain for Qwen.

### gpt-oss-20b

- **Let `--fit on` place the experts.** 31.7 t/s generation and 471 t/s prompt, against 25 and 310 for the hand-picked split.
- **Keep CPU-only as the fallback.** 8 threads beat 16, at about 19.5 t/s.
- **Leave EAGLE3 off by default.** It helps only long JSON-like output (+17% on the offer), hurts short answers (-16%) and uses 1.1 GB more VRAM.
- **Drop ngram-mod.** It gives no gain.
- **Keep top_k 100.** It costs no speed, so S23's "top_k 100 for gpt-oss" stands.

## What changes for S23

S23 says "Qwen 3.5 9B MTP on GPU with 1 slot, gpt-oss on CPU, KV q8_0, drafts (EAGLE3, MTP, ngram-mod) gated by benchmark". The sweep confirms MTP and KV q8_0, and gates EAGLE3 and ngram-mod out by default.

"gpt-oss on CPU" has two answers, and T18 records both:

- **The GPU is free.** `--fit on` on the GPU is 1.6x faster than CPU-only.
- **Both models run at once.** Qwen and gpt-oss together do not fit in 8 GB (5.8 + 7.1 GB), so S23's split, Qwen on the GPU and gpt-oss on the CPU, holds.

The S# text is unchanged. The user decides in T18.

## Limits

- **No chat template.** Prompts went to raw `/completion`; real tool-calling prompts through the chat template were not measured, and gpt-oss content is not representative (finding 7).
- **Quality was not measured.** Speculative outputs differ from the base (finding 4); the eval set (T28) has to judge them.
- **One slot, one context size.** Multiple slots and contexts above 8192 were not measured.
- **Options not tried.** `--load-mode none` and other `--n-cpu-moe` values were not measured.
- **Models not tried.** gpt-oss-safeguard-20b, the embedding and the reranker wait for a later pass.
- **One machine, one power state.** No Windows run, no battery power, no long sessions: each config ran a few minutes, so thermals were not tested.
- **One slow run is unexplained.** The earlier Qwen base result of 26.9 t/s (finding 2) has no known cause.
