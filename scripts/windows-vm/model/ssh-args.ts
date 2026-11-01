import type { WindowsVmPaths } from "../types/windows-vm";
import { GUEST_HOST, GUEST_USER, SSH_PORT } from "./vm-config";

export const REACHABLE_CHECK = "echo ok";
export const READY_MARKER_CHECK = "Test-Path C:\\OEM\\ready.txt";
// sshd already runs this line in PowerShell (the default shell); that outer shell would turn any
// failing inner exit code into 1, so it hands the inner one back with `exit $LASTEXITCODE`.
export const GUEST_COMMAND = "powershell -NoProfile -Command -; exit $LASTEXITCODE";
export const MAKE_UPLOAD_DIRECTORY =
  "New-Item -ItemType Directory -Force -Path C:\\goop | Out-Null";

const TARGET = `${GUEST_USER}@${GUEST_HOST}`;

/**
 * Options shared by ssh and scp: only the VM key, host keys kept in .temp/ (every run is a
 * fresh VM), and never an interactive prompt.
 */
function sshOptions(paths: WindowsVmPaths): string[] {
  return [
    "-i",
    paths.sshKey,
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    `UserKnownHostsFile=${paths.knownHosts}`,
    "-o",
    "ConnectTimeout=6",
    "-o",
    "BatchMode=yes",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "LogLevel=ERROR",
  ];
}

export function sshArgs(paths: WindowsVmPaths, remoteCommand: string): string[] {
  return ["ssh", ...sshOptions(paths), "-p", String(SSH_PORT), TARGET, remoteCommand];
}

export function scpUploadArgs(paths: WindowsVmPaths, localPath: string): string[] {
  return [
    "scp",
    ...sshOptions(paths),
    "-P",
    String(SSH_PORT),
    "-r",
    localPath,
    `${TARGET}:C:/goop/`,
  ];
}

export function scpDownloadArgs(
  paths: WindowsVmPaths,
  guestPath: string,
  destination: string,
): string[] {
  return [
    "scp",
    ...sshOptions(paths),
    "-P",
    String(SSH_PORT),
    "-r",
    `${TARGET}:${guestPath.replaceAll("\\", "/")}`,
    `${destination}/`,
  ];
}

export function keygenArgs(paths: WindowsVmPaths): string[] {
  return [
    "ssh-keygen",
    "-q",
    "-t",
    "ed25519",
    "-N",
    "",
    "-C",
    "goop-windows-vm",
    "-f",
    paths.sshKey,
  ];
}
