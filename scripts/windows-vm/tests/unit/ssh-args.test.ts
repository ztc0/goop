import { describe, expect, test } from "bun:test";
import { windowsVmPaths } from "../../model/paths";
import {
  GUEST_COMMAND,
  keygenArgs,
  MAKE_UPLOAD_DIRECTORY,
  REACHABLE_CHECK,
  READY_MARKER_CHECK,
  scpDownloadArgs,
  scpUploadArgs,
  sshArgs,
} from "../../model/ssh-args";

const paths = windowsVmPaths("/repo");

const OPTIONS = [
  "-i",
  "/repo/.local/windows/ssh/id_ed25519",
  "-o",
  "StrictHostKeyChecking=no",
  "-o",
  "UserKnownHostsFile=/repo/.temp/windows/known_hosts",
  "-o",
  "ConnectTimeout=6",
  "-o",
  "BatchMode=yes",
  "-o",
  "IdentitiesOnly=yes",
  "-o",
  "LogLevel=ERROR",
];

describe("ssh and scp arguments", () => {
  test("ssh uses the VM key, a known_hosts file inside the repo and port 2222", () => {
    expect(sshArgs(paths, REACHABLE_CHECK)).toEqual([
      "ssh",
      ...OPTIONS,
      "-p",
      "2222",
      "goop@127.0.0.1",
      "echo ok",
    ]);
  });

  test("the remote commands", () => {
    expect(REACHABLE_CHECK).toBe("echo ok");
    expect(READY_MARKER_CHECK).toBe("Test-Path C:\\OEM\\ready.txt");
    expect(GUEST_COMMAND).toBe("powershell -NoProfile -Command -; exit $LASTEXITCODE");
    expect(MAKE_UPLOAD_DIRECTORY).toBe(
      "New-Item -ItemType Directory -Force -Path C:\\goop | Out-Null",
    );
  });

  test("scp uploads into C:\\goop\\ and downloads into a local folder", () => {
    expect(scpUploadArgs(paths, "/repo/src")).toEqual([
      "scp",
      ...OPTIONS,
      "-P",
      "2222",
      "-r",
      "/repo/src",
      "goop@127.0.0.1:C:/goop/",
    ]);
    expect(scpDownloadArgs(paths, "C:\\goop\\out.xml", "/repo/.temp/windows/results/x")).toEqual([
      "scp",
      ...OPTIONS,
      "-P",
      "2222",
      "-r",
      "goop@127.0.0.1:C:/goop/out.xml",
      "/repo/.temp/windows/results/x/",
    ]);
  });

  test("ssh-keygen makes an ed25519 key without a passphrase", () => {
    expect(keygenArgs(paths)).toEqual([
      "ssh-keygen",
      "-q",
      "-t",
      "ed25519",
      "-N",
      "",
      "-C",
      "goop-windows-vm",
      "-f",
      "/repo/.local/windows/ssh/id_ed25519",
    ]);
  });
});
