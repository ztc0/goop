# Spike: OpenTUI on Windows (T15b)

- **Question:** Does a minimal OpenTUI screen, in a Bun executable cross-compiled on Linux, start in a Windows terminal, draw its text and react to a key?
- **Why it matters:** T25 (the TUI) must run on Windows; OpenTUI loads a native library, untested on Windows inside a compiled executable (S11, S12).
- **Timebox:** 2 h; **time used:** 36 min (2026-11-02 22:35 to 23:11). The VM runs (about 48, 33 and 45 s) and a Podman restart after a host reboot were machine waits.
- **What an answer looks like:** the screen's text appears in the captured terminal output and a key press makes it exit 0, or the exact error and what fixes it.

Run under the `spikes` skill: the code lived only in `.temp/spikes/t15b-opentui-windows/` and was deleted after this report.

## Answer

Yes: an OpenTUI 0.8.1 screen, compiled on Linux with Bun 1.4.2 for Windows x64, started under a Windows console (ConPTY), drew its box and text, and exited 0 on one key; the native `opentui.dll` is embedded in the executable, so nothing ships beside it.

## Findings

1. **The Windows native library embeds itself.** `@opentui/core-win32-x64` loads `opentui.dll` with `import("./opentui.dll", { with: { type: "file" } })`, so `bun build --compile --target=bun-windows-x64` puts the whole DLL inside the executable with no flags and no warnings. On Windows it loaded from there.
2. **The build machine must install the Windows package.** On Linux, `bun add @opentui/core` installs only the Linux native packages. `bun install --os=win32 --cpu=x64` (Bun 1.4.2) adds `@opentui/core-win32-x64` without changing `package.json`.
3. **It draws correctly in ConPTY.** Truecolor colors and the Unicode box characters came through unchanged; one key press closed it and restored the screen.
4. **Without a console it hangs.** With stdin, stdout and stderr redirected, it drew one 80x24 frame into the pipe and waited for a key forever, with no error.
5. **OpenTUI sends many terminal queries** (kitty keyboard, OSC 66, 99, 1337, 7501, window size) and turns on every mouse mode. The Windows console answers few of them, and OpenTUI did not need the answers.
6. **The executable is about 102 MB.** It includes OpenTUI's tree-sitter worker and its `.wasm` and `.scm` files.

## Evidence

- Versions: Bun 1.4.2 (744846f84), target `bun-windows-x64-v1.4.2`; `@opentui/core` 0.8.1 and `@opentui/core-win32-x64` 0.8.1 (`opentui.dll`, 8,886,664 bytes, sha256 `18b068e3745133329eb811956b48f098e6d389d49d89d1fff3f4ba8ef8e26689`). Native packages listed by `@opentui/core`: `core-{darwin-x64,darwin-arm64,linux-x64,linux-arm64,win32-x64,win32-arm64,linux-x64-musl,linux-arm64-musl}`. Guest: `Microsoft Windows [Version 10.0.26100.1742]` in the throwaway VM. `app.exe`: 101,872,640 bytes, sha256 `ab8a159c39a0c0aebc70825e7ef146738a67a19ca176b7aa1ec328433f3bb211`.
- The whole app (`S=.temp/spikes/t15b-opentui-windows`, its own `package.json`, packages installed with `--ignore-scripts`):

```ts
import { BoxRenderable, TextRenderable, createCliRenderer } from "@opentui/core";

process.stderr.write("SPIKE-START\n");
const renderer = await createCliRenderer({ exitOnCtrlC: false });
const box = new BoxRenderable(renderer, {
  id: "box",
  border: true,
  borderStyle: "single",
  width: 30,
  height: 5,
  padding: 1,
});
box.add(new TextRenderable(renderer, { id: "t", content: "GOOP SPIKE READY" }));
renderer.root.add(box);
renderer.keyInput.once("keypress", (key) => {
  renderer.destroy();
  process.stderr.write(`SPIKE-EXIT key=${JSON.stringify(key.name)}\n`);
  process.exit(0);
});
```

```sh
bun scripts/dev-env/run.ts sh -c "cd $S && bun add --ignore-scripts @opentui/core"
#   installed @opentui/core@0.8.1
bun scripts/dev-env/run.ts sh -c "cd $S && bun install --ignore-scripts --os=win32 --cpu=x64"
#   1 package installed
(sleep 2; printf 'x') | timeout 20 script -qec "bun $S/app.ts" $S/linux-typescript.log
#   exit=0: SPIKE-START, the box drawn, SPIKE-EXIT key="x"
bun scripts/dev-env/run.ts bun build --compile --target=bun-windows-x64 $S/app.ts --outfile $S/app.exe
#   [55ms]  bundle  21 modules
#   [181ms] compile  .temp/spikes/t15b-opentui-windows/app.exe bun-windows-x64-v1.4.2
bun run windows:run -- --copy $S/app.exe --copy $S/conpty.ps1 --fetch 'C:\goop\screen.txt' -- \
  'powershell -NoProfile -ExecutionPolicy Bypass -File C:\goop\conpty.ps1; exit $LASTEXITCODE'
#   HOST: app exit code = 0
```

The executable contains `module.exports = "B:/~BUN/root/opentui-h4y7jasg.dll"` and the full DLL bytes. `conpty.ps1` was a small C# ConPTY host (through `Add-Type`): an 80x24 pseudo console, started `app.exe` with `STARTF_USESTDHANDLES` and null handles, saved the screen to `screen.txt`, sent `x` after 4 s and returned the app's exit code. Its first version left out `STARTF_USESTDHANDLES`, so the app inherited the SSH pipes, never saw the key and was killed (exit 99); that was a harness bug, not an app bug.

Excerpts of `screen.txt` (escape shown as `^[`; ConPTY writes spaces as cursor moves `^[[1C`, so the text reads `GOOP^[[1CSPIKE^[[1CREADY`):

```text
^[[?9001h^[[?1004h^[[?25l^[[2J^[[m^[[HSPIKE-START
^[]0;C:\goop\app.exe^G^[[?25h^[[?2031h^[[>0q^[[?u^[]99;i=opentui-notifications:p=?;^[\^[]1337;Capabilities^[\^[]7501;?^[\^[]66;w=1; ^[\^[]66;s=2; ^[\^[[?1049h^[[>4;1m^[[?2027h^[[?2004h^[[?1004h^[[?1000h^[[?1002h^[
┌────────────────────────────┐
│^[[28C│
│^[[1CGOOP^[[1CSPIKE^[[1CREADY^[[11C│
└────────────────────────────┘^[[mSPIKE-EXIT key="x"^[]22;^[\^[[>4;0m^[[?1003l^[[?1002l^[[?1000l^[[?1006l^[[?2004l
^[[?25h^[[?1049l^[[?2031l^[]0;^G^[[0 q^[[?25l^[[HSPIKE-START^[[K
```

Without a console (`Start-Process -NoNewWindow -RedirectStandardOutput … -RedirectStandardError …`, killed after 15 s): `TIMEOUT: killed after 15 s`; stderr `SPIKE-START`; stdout held one full 80x24 frame with the box and `GOOP SPIKE READY`.

## Recommendation

For T25:

- OpenTUI is viable on Windows as one self-contained executable.
- The Windows build installs `@opentui/core-win32-x64` explicitly (`bun install --os=win32 --cpu=x64`, or a pinned optional dependency) before `bun build --compile --target=bun-windows-x64`. No DLL ships beside the executable.
- Check `process.stdin.isTTY` and `process.stdout.isTTY` at start and fail with a clear message, because without a console the app hangs.
- Test resize, mouse, Ctrl+C, Windows Terminal and PowerShell 7 during T25.
- Check how much of the 102 MB the tree-sitter assets take, and whether goop needs them.

## Limits

- Only a scripted ConPTY at 80x24 on an evaluation VM; not Windows Terminal or a visible console window.
- One key (`x`); no resize, mouse events, Ctrl+C or arm64.
- No React layer (`@opentui/react`), only the core API.
- On Linux only a `script` pseudo terminal with a piped key, not a real terminal emulator.

## Cleanup

- Spike code deleted: `.temp/spikes/t15b-opentui-windows/` (including `node_modules` and `app.exe`) and the VM run results under `.temp/windows/results/`.
- System changes undone: none on the host; the VMs were thrown away after each run.
