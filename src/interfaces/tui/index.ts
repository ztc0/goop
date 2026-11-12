// TUI: `goop`, the client the user talks to; it reaches the daemon only over the channel (S1, S3).

export {
  type Prompt,
  PromptCancelledError,
  type PromptInput,
  type PromptOutput,
  terminalPrompt,
} from "@/interfaces/tui/adapters/terminal-prompt";
export { openGoop, type Timeouts, VAULT_TIMEOUT_MS } from "@/interfaces/tui/services/open-goop";
export {
  pingDaemon,
  REPLY_TIMEOUT_MS,
  type TuiOutput,
} from "@/interfaces/tui/services/ping-daemon";
