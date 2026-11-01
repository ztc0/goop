# goop: local job search agent (MVP)

Free TUI agent with local models that finds developer job offers, matches them against the user's CV and shows the best ones, with a chat that keeps working while it searches in the background. Public portfolio repository.
Design details live in Engram under `job-search-agent/*` topic keys; this document is the plan. Nothing is published to GitHub until the user reviews and approves it.

## Specs

User wording is quoted verbatim (Spanish) where it exists; the rest restates decisions the user approved.

### Identity and goal

- **S1.** "Quiero crear un agente que busque ofertas de trabajo para desarrolladores y me diga cuáles encajan con mi CV. Es para mi portafolio, gratis, con modelos locales y en una TUI."
- **S2.** "el nombre del agente es goop y el logo es un fuego con dos ojos". Commands: `goop` (TUI), `goop daemon` (service); config directory `goop`.
- **S3.** MVP scope: search, profile, evaluation, chat + list, Learner. Future phases (not discarded, "esto no esta descartado"): applying with approval (LinkedIn/Indeed decision pending), CV tailoring, AI filter simulator, scam detection, Gmail, Calendar, interview prep, market gap analysis, statistics, scraping and scraper self-repair.

### Foundation (phase 0)

- **S4.** "antes de hacer todo vamos a hacer la estrcutura completa y el repo con su permisos es publico". Own git repository inside `goop/`, the agreed folder structure, public-repo files, GitHub permissions documented and applied only after publishing.
- **S5.** "antes de publicar en github voy a revisar": no push, no remote creation and no publishing without the user's explicit approval.
- **S6.** "vamos a hacer el agents.md con todass las relas y aplicar la dibulgacion progrecivas": a short root `AGENTS.md` (summary, commands, golden rules, map) plus detailed rule files loaded on demand, and per-folder `AGENTS.md` where a folder has its own rules (scope rule).
- **S7.** "vamos a usar husky y commit cemanticos": Husky with commitlint (Conventional Commits) on `commit-msg`; `pre-commit` runs Biome on staged files, typecheck and fast tests.
- **S8.** "todo las configuraciones ne typescript y usar alais eje: @/": strict TypeScript, path alias `@/*` -> `src/*`, Biome, scripts `dev`, `test`, `typecheck`, `lint`, `build`.
- **S9.** Licenses: app code GPL-3.0 ("vamos a usar glp 3.0"); our quantized Qwen3-Reranker GGUF Apache-2.0 with Qwen attribution and modification notice; `NOTICE` plus a generated `THIRD_PARTY_LICENSES.md`, checked in CI for missing or GPL-incompatible licenses; `CONTRIBUTING.md` with a CLA.
- **S10.** Docs structure: `docs/{product,architecture,adr,guides,development,research}` as agreed, ADRs for decisions, docs in English, root `README.md` with the English section open and the Spanish section collapsed (`<details>`), the Mermaid diagram outside both sections, `SECURITY.md`, `CHANGELOG.md`, `CODE_OF_CONDUCT.md`; prompts in root `prompts/`, visual design in `design/`, plan in `odd/tasks/`.
- **S11.** Architecture: Screaming Architecture with hexagonal layers per feature (`types/`, `model/`, `services/`, `adapters/` with subfolders when 2+ kinds, `tests/{unit,integration}`, `index.ts`), scope rule (`shared/` for 2+ features), root `tests/{integration,e2e}`, one executable with two modes talking JSON-RPC 2.0 over a Unix socket / Windows named pipe.
- **S25.** "no quiero en susiar mi pc vamoa a usar una carptea para eso que te parese .local en el repo": in development, `GOOP_HOME=<repo>/.local` redirects every goop path (config, data, state, cache incl. Bun/uv/Hugging Face caches, models, bin, build) into the repo; without `GOOP_HOME` the app uses the normal XDG / `%APPDATA%` paths. Things that inherently touch the system (systemd timer, TPM credentials, keyring, DPAPI) are not installed in development: a clearly marked insecure dev key lives in `.local`, and the real TPM is exercised only in its spike, with the user's permission and undone afterwards. No project command writes outside the repo without asking first, naming the exact path.
- **S26.** "y las archivo/carpeta en .temp que son temporales": `.temp/` holds everything disposable (`tmp/` targeted by `TMPDIR`/`TMP`/`TEMP`, `tests/`, `downloads/` partial files moved to `.local/models` after hash verification, `extract/` with a fresh empty folder per archive, `scratch/` for the agent's working copies instead of `/tmp`, `run/` for the socket). `bun run clean` deletes `.temp/` only; `.local/` has its own command with confirmation. Both folders are gitignored.
- **S28.** "no use carpetas .gitkeep si no vas a usarlar no la crear solo la vas a crear cuando va a crear los archivos": no `.gitkeep` and no empty placeholder folders; a folder appears only when its first real file is created.
- **S27.** "en docs para los flujos usa Mermaid eso es una regla": every flow in `docs/` is drawn as a Mermaid diagram; this rule is part of the documentation rules in `AGENTS.md`.
- **S12.** Stack: Bun >= 1.3.14, TypeScript strict, OpenTUI + React, LangGraph + LangChain, bun:sqlite + SQLite3MultipleCiphers + sqlite-vec + FTS5, unpdf, mammoth, zod, html-to-text, Biome, `bun build --compile`; TOML config at XDG / `%APPDATA%` paths; Linux and Windows, macOS later.

### UI/UX (phase 1)

- **S13.** "la ui/ux lo vamos a hacer junto al plan": logo and screens designed with the design tool before implementing them ("antes que tu implemntes vamos a diceñarlo").
- **S14.** Screens: onboarding W0-W9 (W1 system check, W2/W2a/W2b/W3 models and download, W5 security mandatory; W4 benchmark, W6/W6b CV and profile, W7 preferences, W8 schedule optional with "skip for now"); main M1-M13 (main chat + list, offer detail, full text, sessions, rules, settings, sources, models, profile, security alert, confirmations, help, privacy). Model startup never blocks the TUI.
- **S15.** "algunas se pueda configurar con lenguage natural": tool `propose_settings` -> zod-validated diff -> user confirms; allowed for preferences, amounts, thresholds, schedule, followed companies, sources, list filters; never for security, model URLs, purge or locked profiles.

### Sources and funnel

- **S16.** Sources: Greenhouse, Ashby, Lever public APIs + RemoteOK, Remotive; Common Crawl discovery (Lever manual); follow-list; connector contract `fetch` + `normalize`; shared runner for limits, retries, dedupe, failure notices.
- **S17.** Funnel: fast filters (incl. profile `related_titles`) -> hybrid retrieval ("Por palabras clave: BM25 con FTS5 de SQLite. Las palabras raras, como “LangGraph”, pesan más que las comunes.") embedding top 200 + BM25 top 200 fused with RRF -> top 100 -> reranker -> Security -> Analytic.
- **S18.** Analytic rubric 0-4 with one evidence sentence per criterion: skills 40, experience 20, conditions 20, growth 10, offer quality 10; company hidden; code computes score and verdict.
- **S19.** Daily background search + on demand, also while chatting; OS scheduler trigger + persistent three-lane queue.

### Agents, prompts and context

- **S20.** Agents: Orchestrator (gpt-oss-20b, Qwen fallback, 8 tools, lazy sticky tools), Explorer (no LLM), Profiler (Qwen, evidence, related_titles, user confirmation), Analytic (Qwen), Validator (code + Qwen judge; returns the error to the agent), Security (gpt-oss-safeguard-20b, clean/suspicious/blocked + fragment), Learner (gpt-oss-20b weekly, ACE-style, "quiero usar apredisaje prosedural", every rule approved by the user).
- **S21.** Prompts in English, replies in the UI language with the Rioplatense personality for user-facing messages; approved prompts for Profiler, judge, embedding, reranker, Security, Analytic, Orchestrator, compaction; topic scope flexible.
- **S22.** Context: progressive disclosure (skills on demand, tools per state, data compact -> detail, TUI disclosure) and lazy loading of context and tools ("le agregamos carga peresosa por contexto y tool"); compaction with a ~6K working budget, tool-result clearing first, structured rolling summary.

### Models and security

- **S23.** Models: download our CI-built minimal llama-server + llama-swap + pinned GGUFs, or API per role; Qwen 3.5 9B MTP on GPU with 1 slot, gpt-oss on CPU, KV q8_0, drafts (EAGLE3, MTP, ngram-mod) gated by benchmark, sampling profiles table with locked judge/guard/reflect, top_k 100 for gpt-oss.
- **S24.** Security and privacy: encrypted DB and files with envelope keys (TPM2 / DPAPI / recovery key), DLP filter, tamper detection, prompt-injection layers, hardened llama-server flags and forbidden-flag check, outbound allowlist, purge and retention.

## Tasks

| ID  | Task                                                                                                                                                                                          | Specs              | Route  | Commit           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------ | ---------------- |
| T1  | Create the local git repository in `goop/` with `main` and a working branch; `.gitignore` with `.local/` and `.temp/`                                                                         | S4, S5, S25, S26   | inline | 2cc5156          |
| T2  | Create the feature entry points (`src/<feature>/index.ts`, `src/shared/index.ts`); every other folder is created only with its first real file, never as an empty placeholder                 | S4, S11, S28       | inline | 5d8c39b, b5926f3 |
| T3  | TypeScript, Bun and Biome configuration with the `@/` alias and scripts that set `GOOP_HOME`, cache dirs and `TMPDIR` to the repo; `clean` script                                             | S8, S12, S25, S26  | inline | e2955d2          |
| T4  | Husky + commitlint (Conventional Commits) + pre-commit checks                                                                                                                                 | S7                 | inline | 59a2491          |
| T5  | Root `AGENTS.md` and detailed rule files with progressive disclosure, including the repo-local paths rule and the Mermaid rule for docs                                                       | S6, S25, S26, S27  | inline | a62103b          |
| T6  | Public repo files: README (+es), LICENSE GPL-3.0, NOTICE, THIRD_PARTY_LICENSES, SECURITY, CHANGELOG, CONTRIBUTING with CLA, CODE_OF_CONDUCT, `.github/` CI, templates, CODEOWNERS, Dependabot | S9, S10            | inline | 888c86d, e4e4760 |
| T7  | Document the GitHub permissions to apply after publishing (branch protection, required CI, secret scanning)                                                                                   | S4, S5             | inline | 509f760          |
| T8  | Design the logo (fire with two eyes)                                                                                                                                                          | S2, S13            | inline | 503417d..1637806 |
| T8b | Implement the chosen logo (04 pixel mascot): frozen pixel grid, half-block terminal rendering, SVG assets and README lockup                                                                   | S2, S13            | inline | 1924477          |
| T9  | Design the TUI screens (onboarding, main, detail, sessions, rules, settings, sources, models, profile, alerts, help, privacy)                                                                 | S13, S14, S15      | inline | -                |
| T10 | Spike: SQLite3MultipleCiphers + sqlite-vec + FTS5 in bun:sqlite, Linux and Windows, inside the compiled executable                                                                            | S12, S17, S24      | inline | -                |
| T11 | Spike: data key wrapping with TPM2 (systemd-creds) and DPAPI, touching the system only with the user's permission and undoing it afterwards                                                   | S24, S25           | inline | -                |
| T12 | Spike: CI build of minimal llama-server with sha256 and attestation                                                                                                                           | S23                | inline | -                |
| T13 | Spike: benchmark sweep on the user's PC (threads, ubatch, KV, -fit, MTP, EAGLE3, ngram-mod, top_k)                                                                                            | S23                | inline | -                |
| T14 | Spike: LangGraph on Bun with a bun:sqlite checkpointer and tool calling on gpt-oss and Qwen                                                                                                   | S20                | inline | -                |
| T15 | Spike: OpenTUI and a user-only named pipe on Windows                                                                                                                                          | S11, S12           | inline | -                |
| T16 | Storage, crypto and integrity layer                                                                                                                                                           | S24                | inline | -                |
| T17 | Daemon, JSON-RPC IPC and the two executable modes                                                                                                                                             | S11                | inline | -                |
| T18 | Model manager: download, verify, llama-swap config, forbidden flags, supervisor, API mode, router, sampling profiles                                                                          | S23, S24           | inline | -                |
| T19 | Offer connectors and shared runner                                                                                                                                                            | S16                | inline | -                |
| T20 | Company discovery and follow-list                                                                                                                                                             | S16                | inline | -                |
| T21 | Profiler and two-layer Validator with user confirmation                                                                                                                                       | S20, S21           | inline | -                |
| T22 | Hybrid retrieval, funnel, Security and Analytic                                                                                                                                               | S17, S18, S20      | inline | -                |
| T23 | Scheduler: queue lanes, systemd timer, Task Scheduler                                                                                                                                         | S19                | inline | -                |
| T24 | Orchestrator chat: tools, lazy loading, skills, DLP, sessions, compaction, NL settings                                                                                                        | S15, S20, S21, S22 | inline | -                |
| T25 | TUI screens from the approved designs                                                                                                                                                         | S14, S15           | inline | -                |
| T26 | Learner: experience log, reflection, curator, replay test, /rules approval                                                                                                                    | S20                | inline | -                |
| T27 | Reranker conversion and Unsloth-style quantization in `tools/quantize/`                                                                                                                       | S9, S23            | inline | -                |
| T28 | Quality evaluation set with synthetic profiles                                                                                                                                                | S18, S21           | inline | -                |
| T29 | Privacy operations: purge, retention, outbound allowlist test                                                                                                                                 | S24                | inline | -                |

Review slices: slice 1 = T1-T3 (2cc5156..e2955d2, ~590 authored lines including the plan); slice 2 = T4-T5 (59a2491..a62103b); slice 3 = T6-T7 (888c86d..T7 commit; most lines are the verbatim GPL-3.0 and Contributor Covenant texts). Deferred from T6: `THIRD_PARTY_LICENSES.md` and its CI check are created with the first runtime dependency (no runtime dependencies yet, S28); the CLA text waits for the maintainer's choice of template.

Route `inline` is the default; a task moves to a worker only when it qualifies under the Writer rule.

## Log

- **L1.** Original request: "Quiero crear un agente que busque ofertas de trabajo para desarrolladores y me diga cuáles encajan con mi CV. Es para mi portafolio, gratis, con modelos locales y en una TUI. Todavía no cambies nada. Hazme preguntas para aclarar la idea, de una en una, esperando mi respuesta. Cuando tengas suficiente, avísame y explícame la idea formulada con tus palabras."
- **L2.** A first plan document was deleted at the user's request ("yo no te dije implemnta", "borralo"); this plan was written only after explicit approval ("ok vamos").
- **L3.** Vision documents (modules, requirements, agent roster, agent prompts) were given as context only; MVP conflicts were resolved one by one (Orchestrator as MVP, Explorer without LLM, vision rubric adopted, Learner on gpt-oss, English prompts with Rioplatense replies, Profiler kept).
- **L4.** Phase 0 request: "ok el nombre del agente es goop y el logo es un fuego con dos ojos. vamos a la planificacion esto es lo vamos hacer antes de hacer todo vamos a hacer la estrcutura completa y el repo con su permisos es publico, vamoa a hacer el agents.md con todass las relas y aplicar la dibulgacion progrecivas, y antes de publicar en github voy a revisar, y vamos a usar husky y commit cemanticos todo las configuraciones ne typescript y usar alais eje: @/ ."
- **L6.** Isolation request: "a unas cosa mas que casi me olvido no quiero en susiar mi pc vamoa a usar una carptea para eso que te parese .local en el repo"; then "y las archivo/carpeta en .temp que son temporales" (approved with "dale").
- **L7.** Docs rule: "y una cosa mas en docs para los flujos usa Mermaid eso es una regla".
- **L8.** Correction during T3: "no use carpetas .gitkeep si no vas a usarlar no la crear solo la vas a crear cuando va a crear los archivos". All `.gitkeep` files and empty folders were removed (b5926f3); feature `index.ts` files were kept as real entry points.
- **L9.** README change: "puedes colocrlop en README.md con una lista desplegalbe primero en ingles y despues el español investiga". `README.es.md` was merged into `README.md`: English in `<details open>`, Spanish in a collapsed `<details>`, and the Mermaid diagram outside both because Mermaid can fail inside `<details>` (mermaid-js #1325, #3504).
- **L10.** T8 logo design started ("dale"): `design/logo/` with three directions, `01-geometric-flame.html`, `02-friendly-mascot.html`, `03-pixel-flame.html`; none chosen yet.
- **L11.** Logo choice: "la [Friendly mascot] pero vamos a colocar un filtro pixel art". Added `design/logo/04-pixel-mascot.html` (02 pixelated with a 5-color palette, adjustable grid, half-block TUI rendering); 01-03 kept as alternatives.
- **L12.** Logo handoff: the user handed off `design/logo/04-pixel-mascot.html` (Pixel mascot) to implement; it is the chosen artboard, and 01-03 stay as alternatives. Tracked as T8b.
- **L13.** Publishing: "ya lo revise pero no se que hacer" -> recommended publishing; the user chose "el correo privado": all commits were rewritten (never published) to the GitHub noreply address, `main` fast-forwarded, and `ztc0/goop` created as a public repository on 2026-11-01. Settings applied: ruleset "Protect main" (PR required with 0 approvals because a sole maintainer cannot approve their own PR, CI checks on Linux and Windows, linear history, no force push, no deletion), private vulnerability reporting, secret scanning with push protection, Dependabot alerts and security updates, CodeQL default setup, read-only workflow token, fork PR approval. From now on changes reach `main` through pull requests.
- **L5.** User PC: Ryzen 9 7940HS, 30 GB RAM, RX 7700S 8 GB (Vulkan RADV) + 780M iGPU listed first, TPM2 present, no secret-service keyring running.
