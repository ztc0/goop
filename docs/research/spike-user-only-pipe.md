# Spike: a user-only named pipe on Windows (T15a)

- **Question:** Can a compiled Bun program on Windows serve a named pipe that only its own user can open, so a second local user is refused?
- **Why it matters:** T17 (daemon and IPC) carries CVs and chats through this pipe (S11, S24).
- **Timebox:** 2 h; **time used:** about 7 min of work (2026-11-02 20:06 to 20:13). The VM run (about 1 min) and a Podman restart after a host reboot were machine waits.
- **What an answer looks like:** the owner connects and a second local user is refused (with the exact error), or the exact reason Bun cannot restrict the pipe plus the workaround that does.

First spike run under the `spikes` skill: the code lived only in `.temp/spikes/t15a-user-only-pipe/` and was deleted after this report.

## Answer

Partial: Bun's own `node:net` pipe server cannot keep a second user out (any local user can open it read-only and read what the server writes), but a pipe created through `bun:ffi` `CreateNamedPipeW` with an owner-only DACL refuses the second user with `ERROR_ACCESS_DENIED` (0x00000005) for both read-write and read-only opens.

## Findings

1. **The default pipe DACL lets every local user read.** `net.createServer().listen(pipePath)` takes no security descriptor, so the pipe gets the Windows default: full access for SYSTEM and Administrators, and **read (`FR`) for Everyone and ANONYMOUS LOGON**. A second standard user opened it read-only and received the server's greeting. Write access was refused (0x5). The server saw that connection as an ordinary one and could not tell the users apart.
2. **`bun:ffi` can create a pipe with an explicit DACL.** `ConvertStringSecurityDescriptorToSecurityDescriptorW` with `D:P(A;;GA;;;<owner SID>)`, passed to `CreateNamedPipeW`, was applied exactly as written; it worked from an executable cross-compiled on Linux. The owner kept full read-write; the second user was refused in both modes.
3. **`FILE_FLAG_FIRST_PIPE_INSTANCE` blocks a second server on the same name** (`CreateNamedPipeW failed 0x00000005`); `node:net` reports `EADDRINUSE` for the same case. Both checks ran as the same user.
4. **PowerShell `Get-Acl` cannot read a pipe's DACL** (error 87, or "does not exist"). `GetSecurityInfo(SE_KERNEL_OBJECT)` on a `READ_CONTROL` handle and `NamedPipeClientStream.GetAccessControl()` can.
5. **The spike server blocks.** It used blocking `ConnectNamedPipe` and `ReadFile`, which would freeze Bun's event loop in a daemon.

## Evidence

- Versions: Bun 1.4.2, target `bun-windows-x64-v1.4.2`, cross-compiled on Linux; `pipe.exe` sha256 `a064d60e72637749984c8c392e9dfe26c06eb0106bfbb5c27479521be2e3c077`. Guest: `Windows 10 Enterprise LTSC 2024 Evaluation 24H2 build 26100.1742` by its registry `ProductName` (the Windows 11 24H2 base, in the throwaway VM of `docs/development/windows-vm.md`). Repo at `c2d62aa`.
- Owner `goop` ran over SSH with an elevated admin token. Second user `goopother`: a new standard user created inside the VM with a password generated there and never printed, given `SeBatchLogonRight` through `secedit` and run through a scheduled task (the T11 method). The client opened the pipe with `CreateFileW` through `bun:ffi`, `GENERIC_READ|GENERIC_WRITE` or `GENERIC_READ`, read one greeting, wrote one ping and, read-write, read the echo.

```sh
bun scripts/dev-env/run.ts bun build --compile --target=bun-windows-x64 \
  .temp/spikes/t15a-user-only-pipe/pipe.ts --outfile .temp/spikes/t15a-user-only-pipe/pipe.exe
bun run windows:run -- --copy .temp/spikes/t15a-user-only-pipe/pipe.exe \
  --copy .temp/spikes/t15a-user-only-pipe/run.ps1 --fetch 'C:\goop\steps.txt' -- \
  'powershell -NoProfile -ExecutionPolicy Bypass -File C:\goop\run.ps1; exit $LASTEXITCODE'
```

Attempt 1, `net.createServer().listen('\\.\pipe\goop-spike-de37d2e4badc')`:

```text
-- owner client rw
  open rw ...: ok
  read 26 bytes: "hello from WORKGROUP\\goop\n"
  wrote 25 bytes
  read 31 bytes: "echo: ping from WORKGROUP\\goop\n"
-- owner client r
  open r ...: ok
  read 26 bytes: "hello from WORKGROUP\\goop\n"
  WriteFile failed GetLastError 0x00000005
-- DACL (GetSecurityInfo on a READ_CONTROL handle)
  SDDL O:BAG:S-1-5-21-1703331661-3392848614-3259780732-513D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;BA)(A;;FR;;;WD)(A;;FR;;;AN)
  Get-Acl: Method failed with unexpected error code 87.
  NamedPipeClientStream.GetAccessControl: O:BAG:S-1-5-21-1703331661-3392848614-3259780732-513D:(A;;FR;;;WD)(A;;FR;;;AN)(A;;FA;;;SY)(A;;FA;;;BA)
    Allow Everyone Read, Synchronize
    Allow NT AUTHORITY\ANONYMOUS LOGON Read, Synchronize
    Allow NT AUTHORITY\SYSTEM 2032127
    Allow BUILTIN\Administrators 2032127
-- goopother client rw
  [client WIN-N6VJBU6CN08\goopother] open rw ...: CreateFileW failed GetLastError 0x00000005
-- goopother client r
  [client WIN-N6VJBU6CN08\goopother] open r ...: ok
  [client WIN-N6VJBU6CN08\goopother] read 26 bytes: "hello from WORKGROUP\\goop\n"
  [client WIN-N6VJBU6CN08\goopother] WriteFile failed GetLastError 0x00000005
-- second node:net server on the same name
  server error EADDRINUSE listen EADDRINUSE: address already in use \\.\pipe\goop-spike-de37d2e4badc
```

Attempt 2, `bun:ffi` `CreateNamedPipeW` on `\\.\pipe\goop-spike-3ead3fbb43e4` with SDDL `D:P(A;;GA;;;S-1-5-21-…-1000)`, `PIPE_ACCESS_DUPLEX|FILE_FLAG_FIRST_PIPE_INSTANCE` and `PIPE_REJECT_REMOTE_CLIENTS`:

```text
-- owner client rw
  open rw ...: ok
  read 26 bytes: "hello from WORKGROUP\\goop\n"
  wrote 25 bytes
  read 9 bytes: "echo: ok\n"
-- owner client r
  open r ...: ok / read 26 bytes / WriteFile failed GetLastError 0x00000005
-- DACL
  SDDL O:BAG:S-1-5-21-1703331661-3392848614-3259780732-513D:P(A;;FA;;;S-1-5-21-1703331661-3392848614-3259780732-1000)
  Get-Acl: Cannot find path 'Microsoft.PowerShell.Core\FileSystem::\\.\pipe\goop-spike-3ead3fbb43e4' because it does not exist.
  NamedPipeClientStream.GetAccessControl: O:BAG:S-1-5-21-...-513D:P(A;;FA;;;S-1-5-21-...-1000)
    Allow WIN-N6VJBU6CN08\goop 2032127
-- goopother client rw
  [client WIN-N6VJBU6CN08\goopother] open rw ...: CreateFileW failed GetLastError 0x00000005
-- goopother client r
  [client WIN-N6VJBU6CN08\goopother] open r ...: CreateFileW failed GetLastError 0x00000005
-- second CreateNamedPipeW server on the same name (FIRST_PIPE_INSTANCE)
  CreateNamedPipeW failed 0x00000005
```

The SIDs belong to the throwaway VM, which no longer exists.

## Recommendation

For T17 (the decision and its ADR belong there):

- Do not serve the Windows pipe with `node:net` or `Bun.listen` as they are: their default DACL lets every local user read.
- Create it through `bun:ffi` `CreateNamedPipeW` with `D:P(A;;GA;;;<current user SID>)` (plus SYSTEM only if needed), `FILE_FLAG_FIRST_PIPE_INSTANCE` on the first instance and `PIPE_REJECT_REMOTE_CLIENTS`, with overlapped I/O or a worker thread so the event loop does not block.
- Have the client check the server (for example `GetNamedPipeServerProcessId` and the owner SID in the pipe's DACL) against a pipe created first by another user.
- Fallback if the FFI server costs too much: a random token in a user-only file under `%LOCALAPPDATA%`, checked on the first message, with the server sending nothing before it. This still lets other users open the pipe read-only; not built.

## Limits

- One run, one VM, an evaluation build.
- The owner ran with an elevated admin token (owner `BA`); a non-elevated owner was not tried. The Everyone and Anonymous read entries are expected either way, but not checked.
- The second user was a standard user under a batch logon; no interactive logon, no second admin.
- Another user creating the pipe name first (squatting) was not tested, nor whether a read-only holder can create an instance (`FILE_CREATE_PIPE_INSTANCE` is not in `FR`, so it should not).
- `GetLastError` was read in a separate FFI call, as in T11.
- `Bun.listen` with a pipe path was not tried on its own; the `node:net` result already answered the question.
- A non-blocking FFI server was not built.

## Cleanup

- Spike code deleted: `.temp/spikes/t15a-user-only-pipe/` and the VM run results under `.temp/windows/results/`.
- System changes undone: none on the host; the second user existed only inside the VM, which was thrown away.
