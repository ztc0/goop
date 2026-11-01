import type { ProcessRequest, ProcessResult, ProcessRunner } from "../types/windows-vm";

/** Runs host programs with Bun.spawn, never through a shell. */
export const bunProcessRunner: ProcessRunner = {
  async run(request: ProcessRequest): Promise<ProcessResult> {
    let child: ReturnType<typeof Bun.spawn>;
    try {
      child = Bun.spawn(request.command, {
        env: { ...process.env, ...request.env },
        stdin: request.stdin === undefined ? "ignore" : new Blob([request.stdin]),
        stdout: request.stream ? "inherit" : "pipe",
        stderr: request.stream ? "inherit" : "pipe",
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { exitCode: 127, stdout: "", stderr: `Cannot run ${request.command[0]}: ${reason}` };
    }
    const [stdout, stderr, exitCode] = await Promise.all([
      child.stdout instanceof ReadableStream ? new Response(child.stdout).text() : "",
      child.stderr instanceof ReadableStream ? new Response(child.stderr).text() : "",
      child.exited,
    ]);
    return { exitCode, stdout, stderr };
  },
};
