import {
  GUEST_COMMAND,
  keygenArgs,
  MAKE_UPLOAD_DIRECTORY,
  REACHABLE_CHECK,
  READY_MARKER_CHECK,
  scpDownloadArgs,
  scpUploadArgs,
  sshArgs,
} from "../model/ssh-args";
import type { GuestShell, ProcessRunner, SandboxPaths } from "../types/sandbox";

/** The guest over SSH and scp, with the key generated for this VM only. */
export function createGuestShell(runner: ProcessRunner, paths: SandboxPaths): GuestShell {
  const ssh = (remoteCommand: string) => runner.run({ command: sshArgs(paths, remoteCommand) });
  return {
    generateKey: () => runner.run({ command: keygenArgs(paths) }),
    async isReachable() {
      const result = await ssh(REACHABLE_CHECK);
      return result.exitCode === 0 && result.stdout.trim() === "ok";
    },
    async isSetupDone() {
      const result = await ssh(READY_MARKER_CHECK);
      return result.exitCode === 0 && result.stdout.trim() === "True";
    },
    prepareUploads: () => ssh(MAKE_UPLOAD_DIRECTORY),
    upload: (localPath) => runner.run({ command: scpUploadArgs(paths, localPath) }),
    download: (guestPath, destination) =>
      runner.run({ command: scpDownloadArgs(paths, guestPath, destination) }),
    async execute(command) {
      // PowerShell reads the script from stdin line by line, so it must end with a newline.
      const result = await runner.run({
        command: sshArgs(paths, GUEST_COMMAND),
        stdin: `${command}\r\n`,
        stream: true,
      });
      return result.exitCode;
    },
  };
}
