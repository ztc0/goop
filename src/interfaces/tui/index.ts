// TUI: `goop`, the client the user talks to; it reaches the daemon only over the channel (S1, S3).

export {
  pingDaemon,
  REPLY_TIMEOUT_MS,
  type TuiOutput,
} from "@/interfaces/tui/services/ping-daemon";
