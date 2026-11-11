// One connection from `goop` to the daemon, with requests matched to their responses by id. It
// does not know whether the channel is a socket or a pipe (S8), and never starts the daemon (L5).
import { CLOSED, connectProblem, tooSlow, UNREADABLE } from "@/interfaces/tui/model/ping";
import type { DaemonReply } from "@/interfaces/tui/types/daemon-reply";
import { type Channel, ChannelError, type JsonRpcRequest } from "@/shared/ipc";

export interface DaemonClient {
  /** Sends one request and waits at most `timeoutMs` for its response. */
  request(
    method: string,
    params: JsonRpcRequest["params"],
    timeoutMs: number,
  ): Promise<DaemonReply>;
  close(): void;
}

/** The connected client, or the line saying why there is none. */
export async function connectDaemon(openChannel: () => Channel): Promise<DaemonClient | string> {
  const waiting = new Map<number, (reply: DaemonReply) => void>();
  const settleAll = (line: string) => {
    for (const settle of waiting.values()) settle({ kind: "problem", line });
  };
  let connection: Awaited<ReturnType<Channel["connect"]>>;
  try {
    connection = await openChannel().connect({
      message(parsed) {
        if (!parsed.ok) return settleAll(UNREADABLE);
        const message = parsed.message;
        if ("method" in message || typeof message.id !== "number") return;
        const settle = waiting.get(message.id);
        if (!settle) return;
        settle(
          "error" in message
            ? { kind: "error", error: message.error }
            : { kind: "result", result: message.result },
        );
      },
      close: () => settleAll(CLOSED),
    });
  } catch (error) {
    if (!(error instanceof ChannelError)) throw error;
    return connectProblem(error.message);
  }

  let lastId = 0;
  return {
    async request(method, params, timeoutMs) {
      const id = ++lastId;
      const { promise, resolve } = Promise.withResolvers<DaemonReply>();
      waiting.set(id, resolve);
      const timer = setTimeout(
        () => resolve({ kind: "problem", line: tooSlow(timeoutMs) }),
        timeoutMs,
      );
      try {
        connection.send({ jsonrpc: "2.0", id, method, ...(params && { params }) });
        return await promise;
      } finally {
        clearTimeout(timer);
        waiting.delete(id);
      }
    },
    close: () => connection.close(),
  };
}
