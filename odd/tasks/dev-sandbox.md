# dev sandbox

Use goop in development the way it runs for real, without leaving files on the maintainer's PC: a light container for everyday work, and one VM per distribution platform for end-to-end runs with the real OS key store. Branch `feat/dev-sandbox` from `dev` `e1d36da`.

## Specs

- S1: "por eso queria usar una sandbox no es que no se puede hcaer fuera del repo. es en una sandbox para no ensusiar la pc con archivos que ne olvida limpiar, y para usar la app en dev pormos usar servicios (./scripts/sandbox/)": goop runs for real in development inside sandboxes, services included; nothing is left on the PC.
- S2: "estoy pensando que se puede hacer sandbox este ejecutando en servicion como la db (date base) para desarrollo podemos aplicar eso y si quiere reniciar podemos usar un comando en la sandbox para reinsatlar la snacho y simplificar esto": a sandbox stays up like a development database service, and one command reinstalls it clean.
- S3: "solo se puede tener una sandbox por sistema es decir dos en total un linux y windows": one sandbox per system: a Linux VM and a Windows VM.
- S4: "si va a tener tpm de linux": the Linux VM has a simulated TPM (swtpm), so `systemd-creds` runs for real; the Windows VM uses DPAPI.
- S5: Sandbox commands (designed after Vagrant, docker compose, multipass, distrobox and earendil-works/pi): `bun run sandbox up|down|reset|shell|logs|status <linux|windows>`; `up` builds the base when missing, starts the VM and runs `goop daemon` as a service; `down` stops it and keeps goop's data; `reset` wipes goop's data; `shell [-- <command>]` uses goop inside; `logs` shows the daemon; `test <system>` stays a separate throwaway run.
- S6: "puedes agrgear bun sandbox ls para ver las dos sistema corriendo (tanto como vm de linux y windos como el contendor de linux)": `bun run sandbox ls` lists the dev container and both VMs, running or not, and whether the daemon is alive.
- S7: "vamos a usar "bun run dev" en contendo sin y los datos pude ir en "./tmp" ... ya que la sandbox conume mucho recurso y asi provamos la funcionalidad": `bun run dev` runs in a light container without a real TPM, goop's data in `.temp/dev/` (`bun run clean` starts over), the CLI and the TUI usable, reloading on every source change.
- S8: "podemos hacer una simusacion de tpm de bun run dev": in `bun run dev`, a fake OS key store inside goop (key in `.temp/dev/`, named `INSECURE-DEV-KEY`) unlocks the vault by itself. It is active only when goop runs from source with `GOOP_HOME` inside the repo, never in the compiled executable; anywhere else goop refuses to start with it. No environment variable alone turns it on.
- S9: "bun run dev:start lo hace en linux por defcto y le pasa la sandbox que que esta ejecutando ... y si que remos usar tpm usams "bun run dev:start" y ahi podemos provar,o punta a punta": `bun run dev:start [linux|windows]` (Linux by default) compiles goop, installs it into the running VM of that system and runs it end to end with the real TPM or DPAPI.
- S10: "la demo" is `goop daemon` running as a background service; `up` covers it.
- S11: No `.env` file: the scripts set every variable (`GOOP_HOME`, `GOOP_RUNTIME_DIR`, caches); the compiled executable never reads a `.env`.

## Tasks

| ID  | Specs             | Task                                                                                                  | Route | Commit        |
| --- | ----------------- | ----------------------------------------------------------------------------------------------------- | ----- | ------------- |
| T1  | -                 | Group the package scripts (`build:native`, `check`, one `sandbox` script)                             | done  | #87 `e1d36da` |
| T2  | S8                | Fake OS key store for development                                                                     | -     | -             |
| T3  | S7, S11           | `bun run dev` in a light container: `.temp/dev/`, daemon in the background, CLI and TUI, reload       | -     | -             |
| T4  | S3, S4, S5        | Linux VM with swtpm: `up`/`down`/`reset`/`shell`/`logs`/`status linux`                                | -     | -             |
| T5  | S3, S5            | Windows VM kept between runs, same lifecycle                                                          | -     | -             |
| T6  | S6                | `bun run sandbox ls`                                                                                  | -     | -             |
| T7  | S9                | `bun run dev:start [linux]`: compile, install into the running Linux VM, end to end with the real TPM | -     | -             |
| T8  | daemon-ipc S5, S6 | The Windows named pipe (moved from daemon-ipc T5)                                                     | -     | -             |
| T9  | S9                | `bun run dev:start windows` with DPAPI                                                                | -     | -             |

T2, T3, T7 and T8 need `goop daemon`, which reaches `dev` with the daemon-ipc chain (#88-#100). T4 and T5 do not.

## Log

- L1: The maintainer, after daemon-ipc T4: "vamos con esto la sandbox", "inevstiga como lo hace https://github.com/earendil-works/pi", "me gusta y podemos usar bun run dev en un contensedor ... y bun run dev:start ... y puedes agrgear bun sandbox ls".
- L2: "en la parte de "demo" me refiero en demonio/servicio ejecutandose en segundo plano y bun run dev:start lo hace en linux por defcto ... solo se puede tener una sandbox por sistema es decir dos en total un linux y windows. el servicio se puede hacer en un contenedor".
- L3: Correction: "si va a tener tpm de linux y vamos a usar "bun run dev" en contendo sin y los datos pude ir en "./tmp" ... y si que remos usar tpm usams "bun run dev:start"". Then "1. ./temp" (taken as `.temp/`), "3. poedemos hacer una simusacion de tpm de bun run dev" (S8), "una pregunta vamosd a usar env" (S11), "ok dame un plan completo porfa", then "ok". T1 shipped first as its own pull request #87.
- L4: Order: the daemon-ipc chain first (it unblocks T2, T3, T7, T8), and T4 while that chain waits for review.
- L5: Names. "esto es confuso" about two Linux names (`linux` VM and `debian` container), then "los test (bun run sandbox test) corre los vm son los e2e y los unitest". Decision: the CLI shows only two systems, `linux` and `windows`, and both are VMs. `bun run sandbox test linux` runs the whole suite (unit, integration and end to end) in the Linux VM with swtpm, so the systemd-creds tests stop skipping; `test windows` stays in the Windows VM. The light container is no longer a sandbox name: it only backs `bun run dev` (T3). The word `debian` leaves the CLI, CI and docs in T4; whether GitHub's Linux runners can run the VM (KVM) is checked in T4 before the CI job changes.
