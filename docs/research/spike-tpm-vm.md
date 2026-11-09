# Spike: tpm-vm

<!-- Card, copied from .temp/spikes/tpm-vm/card.md -->

- **Question:** Can a throwaway Debian 13 VM with a software TPM (QEMU + `swtpm` inside a Podman container, like the Windows sandbox) boot with systemd, report `systemd-analyze has-tpm2` = yes, and seal and open a DEK with goop's `systemdCredsEnvelope` (host+tpm2)?
- **Why it matters:** T2's TPM2 path (S5 of [`odd/tasks/storage.md`](../../odd/tasks/storage.md)) is unproven without touching the user's PC (L10); T6 joins every piece. Sandbox S5 ([`odd/tasks/sandbox.md`](../../odd/tasks/sandbox.md)) deferred this VM until a task needed it.
- **Timebox:** 2 h; **time used:** 0:09 (2026-11-03 18:40 to 18:49), machine waits included (about 2 min: two image builds, the download and four boots).
- **What an answer looks like:** yes/no/partial, with `has-tpm2` output, the credential key type, and a seal/open round trip of the compiled adapter inside the VM; or the exact blocker.

## Answer

Yes: a Debian 13 VM booted with UEFI (OVMF), `swtpm` and the TPM2 libraries reported `has-tpm2` = `yes`, and goop's compiled `systemdCredsEnvelope` sealed and opened a DEK as a normal user, with the key type `CRED_AES256_GCM_BY_HOST_AND_TPM2_HMAC_SCOPED`.

## Findings

1. **Two things are needed for `yes`, and the plain cloud image has neither.** With SeaBIOS and the stock `genericcloud` image, `systemd-analyze has-tpm2` printed `partial` with `-firmware` and `-libraries` (`libtss2-esys.so.0`, `libtss2-rc.so.0`, `libtss2-mu.so.0` missing), exit 17. Installing `libtss2-esys-3.0.2-0t64`, `libtss2-rc0t64` and `libtss2-mu-4.0.1-0t64` in the guest fixed `libraries` (exit 1, still `partial`). Booting the same disk with UEFI (OVMF, `-machine q35`) fixed `firmware`: `yes`, exit 0. The kernel found the TPM in both cases (`tpm_tis MSFT0101:00: 2.0 TPM`); only UEFI gives systemd the firmware's TPM event log.
2. **goop's adapter refuses the partial TPM, as designed.** Under SeaBIOS, `availability()` gave `{"available":false,"reason":"no-tpm2",...}` and `seal` threw `OsEnvelopeUnavailableError` before any encryption; `/var/lib/systemd/credential.secret` was not created.
3. **The round trip works as a normal user.** Under UEFI, as `goop` (UID 1000, not in any TPM group; `/dev/tpm0` and `/dev/tpmrm0` are `root:root 0600`): `availability()` gave `{"available":true}`, `seal` returned 584 bytes of base64 (432 decoded), `open` returned the same 32 bytes (sha256 compared). The TPM work is done by the root `systemd-creds.socket` service on `/run/systemd/io.systemd.Credentials`, which created `/var/lib/systemd/credential.secret` (root, `0400`, 4112 bytes) on first use, inside the guest.
4. **The key type proves host+tpm2.** `ef4ac13679a9480ea7db68897f9f165d` is `CRED_AES256_GCM_BY_HOST_AND_TPM2_HMAC_SCOPED` in systemd v257 `src/shared/creds-util.h:74-75`. It differs from the host-only `55b9ed1d38594d43a8319d2ebb332ac6` (`CRED_AES256_GCM_BY_HOST_SCOPED`) seen in the TPM-less container (L8), and from the v262 `..._SCOPED_PINNED_SRK` type on the user's PC (T11 spike).
5. **It survives a cold boot.** After `systemctl poweroff`, a new QEMU and a new `swtpm` process over the same state folder, `open` of the same credential gave the same DEK.
6. **A different TPM refuses it.** With a fresh `swtpm` state (same disk, same `credential.secret`), `has-tpm2` was still `yes`, but `open` threw `OsEnvelopeOpenError` (the raw tool: `Failed to decrypt: io.systemd.System`). A new seal on the fresh TPM worked. So the TPM is part of the key, not only the host file.
7. **In user scope, `--with-key` is not fully honoured.** On this VM `--user --with-key=host` also gave the host+tpm2 key type, and `--with-key=tpm2` was refused (`Selected key not available in --uid= scoped mode, refusing.`). goop does not depend on this: it always asks for `host+tpm2` and checks `has-tpm2` first.
8. **The VM is fast and needs nothing on the host.** QEMU runs inside a rootless Podman container with only `--device /dev/kvm`; there is no published port (SSH to the guest runs from inside the container through QEMU's user network on the container's own `127.0.0.1:2222`). Boot to SSH took about 13 s each time.

## Evidence

The spike code is deleted, so this section must be enough to repeat the result.

- Versions:
  - Host: Arch Linux, kernel 7.2.11-arch1-1, Podman 6.1.4 rootless, Bun 1.4.2, `/dev/kvm` `crw-rw-rw- root kvm`.
  - Container image `localhost/goop-spike-tpm-vm:2` (`790d3fc3cf22`), `FROM docker.io/library/debian:trixie@sha256:e2914ec98e08b24b4cee3cefcb9f90dfb5519f8d215a2ccf0c9a49b10b6e43de` (the pin of `scripts/sandbox/debian/Containerfile`), with `qemu-system-x86 1:10.0.13+ds-0+deb13u1`, `qemu-utils 1:10.0.13+ds-0+deb13u1`, `swtpm 0.7.1-1.5`, `swtpm-tools 0.7.1-1.5`, `libtpms0 0.9.2-3.2`, `ovmf 2025.02-8+deb13u1`, `genisoimage 9:1.1.11-4`, `openssh-client 1:10.0p1-7+deb13u4`. Image `:1` (`bbea188a7693`) is the same without `ovmf`.
  - Guest: Debian 13.7, kernel `6.12.113+deb13-cloud-amd64`, `systemd 257 (257.13-1~deb13u1)` with `+TPM2`, `libtss2-* 4.1.3-1.2` installed from Debian's apt.
- Pinned inputs:
  - Cloud image: `https://cloud.debian.org/images/cloud/trixie/20261026-2643/debian-13-genericcloud-amd64-20261026-2643.qcow2`, checked against `https://cloud.debian.org/images/cloud/trixie/20261026-2643/SHA512SUMS`: sha512 `3ace18e33bdd036edb49d1f79342bd01d2ab980e35194edb0b410435cd543538d286a0bd13bbb0835f7862306e3d385ce2f6a70d8ecf0bd961111166adbc1b8e` (`OK`), sha256 `dd7f5e92d879a983d757fc6acd8c5df0294abd9ba57137b29f8c863bb74a6904`.
  - systemd source for the key type names: `https://raw.githubusercontent.com/systemd/systemd/v257/src/shared/creds-util.h`, sha256 `f8e84e0e22df9ddba2a3b7d080901ada08a50aa4224e42bdacbe7abdc64c135c`.
  - Probe executable (`bun build --compile --target=bun-linux-x64` of a 30-line script importing `newDataKey` and `systemdCredsEnvelope` from `@/shared` at `feat/storage` 01b10ce, adapter as committed in 721e995): sha256 `47968656d7f3b96b33b05b09b2c87ed2b5437106038ce7990edb25aa158b27ca`. It prints `availability()`, seals a fresh DEK into a file, prints the first 16 decoded bytes in hex, opens the file and compares the sha256 of the DEK.
- Container and VM (`$P` is `bun scripts/dev-env/run.ts podman --root $PWD/.local/containers/storage --runroot $PWD/.temp/containers/run --tmpdir $PWD/.temp/containers/tmp`, `$S` the spike folder):

```sh
$P build --tag localhost/goop-spike-tpm-vm:2 --file $S/image/Containerfile $S/image
$P run -d --name goop-spike-tpm-vm-uefi --device /dev/kvm -v $S:/spike -v $S/dl-image:/base:ro \
  localhost/goop-spike-tpm-vm:2 sleep infinity

# Inside the container: NoCloud seed (user goop, UID 1000, a throwaway ed25519 key) and an overlay disk.
genisoimage -quiet -output /spike/vm/seed.iso -volid cidata -joliet -rock user-data meta-data
qemu-img create -q -f qcow2 -F qcow2 -b /base/debian-13-genericcloud-amd64-20261026-2643.qcow2 /spike/vm/disk.qcow2 8G
cp /usr/share/OVMF/OVMF_VARS_4M.fd /spike/vm/ovmf-vars.fd
swtpm socket --tpm2 --tpmstate dir=/spike/tpm-state --ctrl type=unixio,path=/spike/vm/swtpm.sock \
  --log file=/spike/vm/swtpm.log,level=2 --pid file=/spike/vm/swtpm.pid --daemon
qemu-system-x86_64 -enable-kvm -cpu host -m 2048 -smp 2 -display none -machine q35 \
  -drive if=pflash,format=raw,unit=0,readonly=on,file=/usr/share/OVMF/OVMF_CODE_4M.fd \
  -drive if=pflash,format=raw,unit=1,file=/spike/vm/ovmf-vars.fd \
  -serial file:/spike/vm/serial.log \
  -chardev socket,id=chrtpm,path=/spike/vm/swtpm.sock -tpmdev emulator,id=tpm0,chardev=chrtpm -device tpm-tis,tpmdev=tpm0 \
  -drive file=/spike/vm/disk.qcow2,if=virtio -drive file=/spike/vm/seed.iso,if=virtio,media=cdrom,readonly=on \
  -netdev user,id=n0,hostfwd=tcp:127.0.0.1:2222-:22 -device virtio-net-pci,netdev=n0 \
  -pidfile /spike/vm/qemu.pid -daemonize
ssh -i /spike/ssh/id_ed25519 -p 2222 goop@127.0.0.1 '<command>'
```

The SeaBIOS run was the same `qemu-system-x86_64` line without `-machine q35` and the two `pflash` drives.

- Commands and outputs, verbatim (in the guest, as `goop`):

```text
$ id
uid=1000(goop) gid=1000(goop) groups=1000(goop)
$ ls -l /dev/tpm*
crw------- 1 root root  10,   224 Nov  3 23:42 /dev/tpm0
crw------- 1 root root 254, 65536 Nov  3 23:42 /dev/tpmrm0

# SeaBIOS, stock cloud image
$ systemd-analyze has-tpm2; echo exit=$?
partial
-firmware
+driver
+system
+subsystem
-libraries
  -libtss2-esys.so.0
  -libtss2-rc.so.0
  -libtss2-mu.so.0
exit=17

# SeaBIOS, after installing the three libtss2 packages
$ systemd-analyze has-tpm2; echo exit=$?
partial
-firmware
+driver
+system
+subsystem
+libraries
  +libtss2-esys.so.0
  +libtss2-rc.so.0
  +libtss2-mu.so.0
exit=1
$ ./goop-tpm-check both bios.cred
availability: {"available":false,"reason":"no-tpm2","message":"No usable TPM2: \"systemd-creds has-tpm2\" did not report yes."}
error: OsEnvelopeUnavailableError No usable TPM2: "systemd-creds has-tpm2" did not report yes.
$ ls -l /var/lib/systemd/credential.secret
ls: cannot access '/var/lib/systemd/credential.secret': No such file or directory

# UEFI (OVMF), same disk and swtpm state
$ ls /sys/kernel/security/tpm0/
binary_bios_measurements
$ systemd-analyze has-tpm2; echo exit=$?
yes
+firmware
+driver
+system
+subsystem
+libraries
  +libtss2-esys.so.0
  +libtss2-rc.so.0
  +libtss2-mu.so.0
exit=0
$ ./goop-tpm-check both uefi.cred
availability: {"available":true}
sealed bytes: 584 decoded: 432
key type: ef4ac13679a9480ea7db68897f9f165d
opened bytes: 32 matches: true
$ sudo ls -l /var/lib/systemd/credential.secret
-r-------- 1 root root 4112 Nov  3 23:45 /var/lib/systemd/credential.secret

# After poweroff and a cold boot, same swtpm state
$ ./goop-tpm-check open uefi.cred
availability: {"available":true}
opened bytes: 32 matches: true

# After poweroff and a boot with a fresh swtpm state
$ systemd-analyze has-tpm2 | head -1
yes
$ ./goop-tpm-check open uefi.cred
availability: {"available":true}
error: OsEnvelopeOpenError The OS key envelope could not be opened: it was changed, or it belongs to another user, machine or name.
$ systemd-creds --user decrypt --name=goop-dek uefi.cred -
Failed to decrypt: io.systemd.System
$ ./goop-tpm-check both fresh.cred
availability: {"available":true}
sealed bytes: 584 decoded: 432
key type: ef4ac13679a9480ea7db68897f9f165d
opened bytes: 32 matches: true

# Key types in user scope: head -c 32 /dev/urandom | systemd-creds --user encrypt --with-key=$k --name=goop-dek - -,
# first 16 decoded bytes in hex
--with-key=host -> ef4ac13679a9480ea7db68897f9f165d
--with-key=host+tpm2 -> ef4ac13679a9480ea7db68897f9f165d
--with-key=auto -> ef4ac13679a9480ea7db68897f9f165d
# --with-key=tpm2, stderr:
Selected key not available in --uid= scoped mode, refusing.
exit=1
# System scope, as root, for comparison
--with-key=host -> 5a1c6a86df9d4096b1d5a65e0862f19a
--with-key=host+tpm2 -> 93a894094874449090caf2fc93cab553
```

```text
$ sudo dmesg | grep -i tpm
[    0.000000] efi: TPMFinalLog=0x7fbd7000 SMBIOS=0x7f988000 ACPI=0x7fb7e000 ACPI 2.0=0x7fb7e014 MEMATTR=0x7e943018 MOKvar=0x7f981000 INITRD=0x7e93c918 RNG=0x7fb72018 TPMEventLog=0x7e0d7018
[    0.021922] ACPI: TPM2 0x000000007FB76000 00004C (v04 BOCHS  BXPC     00000001 BXPC 00000001)
[    0.034321] ACPI: Reserving TPM2 table memory at [mem 0x7fb76000-0x7fb7604b]
[    0.683619] tpm_tis MSFT0101:00: 2.0 TPM (device-id 0x1, rev-id 1)
$ systemctl list-sockets --no-legend | grep -i cred
/run/systemd/io.systemd.Credentials    systemd-creds.socket            -
```

## Recommendation

- **T2 (S5):** the TPM2 path of `systemdCredsEnvelope` is now proven on systemd 257 with a software TPM, with no change to the adapter. T2 can close its "real run" gap with this VM instead of the user's PC; a run on real hardware stays optional.
- **T6 (S9):** use the VM for the key service's end-to-end checks: setup seals, a cold boot opens, and a lost TPM (fresh `swtpm` state) must fall back to the recovery envelope and write a new OS envelope. Note that a lost TPM is reported as `OsEnvelopeOpenError` while `availability()` is still `{"available":true}`: T6 must treat "available but cannot open" as "go to recovery", never as "create a new DEK".
- **Sandbox S5 (T7 of `odd/tasks/sandbox.md`):** a Debian VM is viable. It must boot with UEFI (OVMF, `q35`), not SeaBIOS, and the guest needs `libtss2-esys-3.0.2-0t64`, `libtss2-rc0t64` and `libtss2-mu-4.0.1-0t64` (or a cloud-init `packages:` list). QEMU, `swtpm` and OVMF fit in one image built from the sandbox's pinned `debian:trixie`, so the VM needs no third-party image like `dockurr/windows`. SSH can stay inside the container, so no host port is needed.
- **ADR, proposed, not written:** "The sandbox's Debian VM runs QEMU, `swtpm` and OVMF from our own image built on the pinned `debian:trixie`, boots the verified Debian `genericcloud` qcow2 through a NoCloud seed, and keeps the `swtpm` state per run (or per base, for reboot tests)." It belongs to sandbox T7, which decides whether the VM is added at all.

## Limits

- Only systemd 257 was tried in the VM; the user's PC runs 262, whose credentials are pinned to the SRK (T11 spike) and incompatible with earlier versions.
- `swtpm` is not hardware: no TPM lockout, timing or firmware bugs. The TPM state folder is a plain file on the host disk.
- No PCR policy was tested (`systemd-creds` was used without `--tpm2-pcrs`), so changes to the boot chain were not tried.
- Secure Boot was off (`OVMF_CODE_4M.fd`, not `secboot`).
- The guest's apt packages and the OVMF and QEMU packages in the image are not pinned beyond the Debian release.
- A second user in the guest was not tried; user scoping was proven on the PC in the T11 spike.
- `tpm-tis` only; `tpm-crb` was not tried.

## Cleanup

- Spike code: `.temp/spikes/tpm-vm/` deleted, with the downloads, the throwaway SSH key and the `swtpm` state.
- Podman: containers `goop-spike-tpm-vm` and `goop-spike-tpm-vm-uefi` and images `localhost/goop-spike-tpm-vm:1` and `localhost/goop-spike-tpm-vm:2` removed from the repo-local storage.
- System changes undone: none made. `credential.secret` was created only inside the guest disk.
