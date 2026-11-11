import type { JsonRpcErrorObject } from "@/shared/ipc";

/** What became of one request to the daemon. */
export type DaemonReply =
  | { kind: "result"; result: unknown }
  | { kind: "error"; error: JsonRpcErrorObject }
  /** No answer: `line` says why (closed, too slow, unreadable), in goop's own words. */
  | { kind: "problem"; line: string };
