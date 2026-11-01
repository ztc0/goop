# windows-vm: Windows test VM driven from TypeScript

Scripts that start Windows in a QEMU container with Podman, run goop's checks in it and bring the results back, with nothing installed on the host. `scripts/` is reorganized with Screaming Architecture.
Branch `feat/windows-vm`, based on `feat/spike-encrypted-sqlite` (its first user is the T10 Windows run).

## Specs

- **S1.** "vamoas hacer algo vamos a crear un scripts que nos van ayudar en el futuro vamos a usar QEMU en ts para windows y automatisar las pruevas usando contenedores para no descargarlo en la pc y se ejecuta ccon el scripts, vamos a organisar esa carpeta usando screeeming artecture"
- **S2.** Scope chosen by the user: "Toda la carpeta scripts/ (Recomendado)", with the layout `scripts/dev-env/` (run, clean, repo-root), `scripts/brand/` (logo-assets), `scripts/spikes/` (encrypted-sqlite) and `scripts/windows-vm/` (start, run-tests, stop) with `types/ model/ services/ adapters/`.
- **S3.** Nothing is installed or written outside the repo (AGENTS.md golden rule 1): Podman images, containers and the Windows disk live under `.local/`, disposable files under `.temp/`.
- **S5.** "dale y cada vez que ejecuta el contenedor se destrulle". The user chose "Contenedor y cambios; Windows instalado queda (Recomendado)": Windows is installed once as a base image in `.local/`; each run starts a new container with `--rm` on a throwaway layer over that base, and the container and the layer are deleted when the run ends, so every run starts clean.
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
- **L4.** "dale y cada vez que ejecuta el contenedor se destrulle"; the user chose "Contenedor y cambios; Windows instalado queda (Recomendado)" (S5).
- **L5.** Research (dockur/windows v6.06): rootless Podman works with `--device /dev/kvm --device /dev/net/tun --cap-add NET_ADMIN` and `USER_PORTS=22`; `VERSION=11l` (4.7 GB ISO, fetched from Microsoft); `/oem/install.bat` runs at the end of setup and can install OpenSSH; commands run over SSH, files move with scp; no documented readiness signal, so poll SSH then a marker file; first install about 25 min, later boots about 2 min. Host: ext4, ssh and scp present.
- **L6.** T2 implemented in `scripts/windows-vm/` (types, model, services, adapters, cli.ts) with `windows:install|run|status`; 48 tests with fake `podman`, `ssh`, `scp` and `ssh-keygen`. Choices beyond the brief: the guest password reaches Podman through the environment (`-e PASSWORD`), never argv; ssh adds `BatchMode=yes`, `IdentitiesOnly=yes`, `LogLevel=ERROR` and keeps host keys in `.temp/windows/known_hosts`. `tests/integration/agents-commands.test.ts` fails until AGENTS.md lists the three `windows:*` scripts (outside the T2 edit surface). T3 must verify: dockur boots an existing `/storage/data.qcow2` overlay whose backing file is `/base/data.qcow2` without reinstalling or converting it; which files dockur keeps in `/storage` after install and whether the copied ones are enough; `qemu-img` is in the image; `exit N` propagates through `powershell -Command -`; scp to `C:/goop/` works with the SFTP-mode scp.
- **L7.** T2 committed as 16b516e (scripts/windows-vm/, 48 tests with fakes; `bun run windows:status` ran for real and kept Podman storage in `.local/containers/`). Review (risk, resilience, reliability) found that sshd's default PowerShell turned any failing guest exit code into 1; bbce866 ends the guest command with `exit $LASTEXITCODE`. The validator escalated because only a real Windows run can prove it: T3 must run `bun run windows:run -- 'exit 3'` and see exit code 3, and consider a guard for a `$null` `$LASTEXITCODE`.
