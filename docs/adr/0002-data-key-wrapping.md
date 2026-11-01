# 0002. One data key, wrapped by the operating system and a recovery key

Date: 2026-11-01. Status: accepted.

## Context

goop encrypts its database and files at rest with envelope keys (S24). The key that encrypts the data must never sit in plain text on disk, must open without a prompt on the user's own machine, and must survive the loss of that machine's key store. In development, nothing touches the system without the user's permission (S25).

The T11 spike tried the OS key stores from the compiled executable. On Linux, `systemd-creds --user` refuses tpm2 alone and needs the host key, which systemd creates on first use. On Windows, DPAPI in user scope works through `bun:ffi`, but failed for the owner for about 20-40 s after another user logged on. Details and sources: [`docs/research/spike-key-wrapping.md`](../research/spike-key-wrapping.md).

## Options

1. **tpm2 only, through direct TPM access.** goop would need the user in group `tss` and its own TPM library.
2. **The libsecret keyring.** No secret-service runs on the user's PC.
3. **A passphrase only.** It works everywhere, but the user types it at every start, and the daemon cannot start alone.
4. **`systemd-creds --user` on Linux and DPAPI on Windows, plus a recovery key and a passphrase fallback.** The spike passed on Linux from source and compiled, and on Windows 11 compiled.

## Decision

goop wraps one data key with the OS key store, a recovery key and, where needed, a passphrase (option 4):

- One random 256-bit data key (DEK) encrypts the database and the files. It is stored only wrapped, never in plain text.
- On Linux, `systemd-creds --user` wraps it with host+tpm2, scoped to the user and pinned to the SRK. The DEK and the credential travel only through stdin and stdout, never argv or a file.
- On Windows, DPAPI wraps it in user scope through `bun:ffi`, with an entropy value.
- A recovery key always wraps it too. Setup shows the recovery key once.
- A passphrase (scrypt) wraps it instead of the OS when the machine has no TPM2 or no systemd 256 or later.
- goop never needs root or the `tss` group.

## Consequences

- The first use on Linux creates `/var/lib/systemd/credential.secret`. Setup (W5) says so before it happens.
- Credentials do not survive a TPM clear or an OS reinstall. The recovery key covers that case.
- systemd before v262 cannot read credentials written by v262.
- A DPAPI failure (`0x5` or `0x8009000b`) is retried with backoff. It is never treated as a lost key, and goop never generates a new DEK over existing data.
- The daemon under a scheduled task needs a logon type that loads the user's DPAPI master key. T23 verifies it.
