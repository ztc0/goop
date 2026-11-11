// goop's single executable (S1, S2): `goop` opens the TUI, `goop daemon` runs the service, and
// the two talk over the private channel. This file only wires the process to the modes.
import { parseCommandLine, platformProblem, USAGE } from "@/interfaces/command-line";
import { serveDaemon } from "@/interfaces/daemon";
import { pingDaemon } from "@/interfaces/tui";
import { runtimeFolder, unixSocketChannel } from "@/shared/ipc";

const output = {
  print: (line: string) => process.stdout.write(`${line}\n`),
  fail: (line: string) => process.stderr.write(`${line}\n`),
};

/** Settles on the first SIGINT or SIGTERM. */
function stopSignal(): Promise<NodeJS.Signals> {
  return new Promise((resolve) => {
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, resolve);
  });
}

async function main(): Promise<number> {
  const command = parseCommandLine(process.argv.slice(2));
  if (command.kind === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command.kind === "invalid") {
    process.stderr.write(`${command.problem}\n${USAGE}`);
    return 2;
  }
  const problem = platformProblem(process.platform);
  if (problem) {
    output.fail(problem);
    return 1;
  }
  // The Linux channel; the Windows one comes with daemon-ipc T5.
  const openChannel = () => unixSocketChannel(runtimeFolder(process.env));
  if (command.kind === "daemon") return serveDaemon(openChannel, output, stopSignal());
  return pingDaemon(openChannel, output);
}

// Exits explicitly: under `bun --watch` a script that only ends would leave the watcher running.
process.exit(await main());
