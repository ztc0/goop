# windows-vm: Windows test VM driven from TypeScript

Scripts that start Windows in a QEMU container with Podman, run goop's checks in it and bring the results back, with nothing installed on the host. `scripts/` is reorganized with Screaming Architecture.
Branch `feat/windows-vm`, based on `feat/spike-encrypted-sqlite` (its first user is the T10 Windows run).

## Specs

- **S1.** "vamoas hacer algo vamos a crear un scripts que nos van ayudar en el futuro vamos a usar QEMU en ts para windows y automatisar las pruevas usando contenedores para no descargarlo en la pc y se ejecuta ccon el scripts, vamos a organisar esa carpeta usando screeeming artecture"
- **S2.** Scope chosen by the user: "Toda la carpeta scripts/ (Recomendado)", with the layout `scripts/dev-env/` (run, clean, repo-root), `scripts/brand/` (logo-assets), `scripts/spikes/` (encrypted-sqlite) and `scripts/windows-vm/` (start, run-tests, stop) with `types/ model/ services/ adapters/`.
- **S3.** Nothing is installed or written outside the repo (AGENTS.md golden rule 1): Podman images, containers and the Windows disk live under `.local/`, disposable files under `.temp/`.
- **S4.** The existing commands keep working after the move: `bun run dev|test|typecheck|lint|format|build|clean|clean:local`, the Husky hooks and their tests.

## Tasks

| ID  | Specs      | Task                                                                                                                                                         | Route  | Commit |
| --- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------ |
| T1  | S2, S4     | Move the existing scripts into `dev-env/`, `brand/`, `shared/`; update `package.json`, Husky, tests and docs                                                 | inline | -      |
| T2  | S1, S2, S3 | `scripts/windows-vm/`: types, pure model (Podman arguments, readiness, results), Podman and SSH adapters, start/status/run/stop services and CLI, with tests | inline | -      |
| T3  | S1, S3     | First real run: install Windows in the container under `.local/`, record time and size                                                                       | inline | -      |
| T4  | S1         | Run the T10 checks on Windows through the script and record the result                                                                                       | inline | -      |
| T5  | S1         | Developer doc for the Windows VM and the `scripts/` layout                                                                                                   | inline | -      |

## Log

- **L1.** "vamoas hacer algo vamos a crear un scripts que nos van ayudar en el futuro vamos a usar QEMU en ts para windows y automatisar las pruevas usando contenedores para no descargarlo en la pc y se ejecuta ccon el scripts, vamos a organisar esa carpeta usando screeeming artecture"
- **L2.** Host check: rootless Podman 6.1.4 (no Docker), `/dev/kvm` usable, 712 GB free. Proposed image: `dockur/windows` (QEMU inside the container, downloads the Windows ISO from Microsoft). Podman storage must be moved from `~/.local/share/containers` to `.local/containers/`.
- **L3.** The user chose "Toda la carpeta scripts/ (Recomendado)".
