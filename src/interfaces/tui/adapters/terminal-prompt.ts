// Asks the user for a passphrase or a recovery key (daemon-ipc S7). On a terminal it reads in raw
// mode and echoes nothing, so the secret never shows on screen or in the scrollback; from a pipe
// (tests, scripts) it reads one line per question. What is typed is returned, never written.

/** What the prompt needs from stdin; `process.stdin` has it. */
export interface PromptInput {
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  on(event: "data", listener: (chunk: string | Uint8Array) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  pause(): unknown;
  resume(): unknown;
}

/** Where the questions go; never the answers. */
export interface PromptOutput {
  write(text: string): unknown;
}

export interface Prompt {
  /** The line typed after `question`, or undefined when the input ended with nothing typed. */
  ask(question: string): Promise<string | undefined>;
}

/** The user pressed Ctrl-C at a prompt. */
export class PromptCancelledError extends Error {
  override name = "PromptCancelledError";
  constructor() {
    super("Cancelled.");
  }
}

const CTRL_C = "\u0003";
const CTRL_D = "\u0004";
const ESCAPE = "\u001b";
const BACKSPACES = new Set(["\u007f", "\b"]);

/**
 * The index of the last character of the escape sequence at `start` (an arrow or function key):
 * `ESC [ ... final` or `ESC O x`; a lone ESC is one character.
 */
function escapeEnd(chars: readonly string[], start: number): number {
  const kind = chars[start + 1];
  if (kind === "O") return Math.min(start + 2, chars.length - 1);
  if (kind !== "[") return start;
  let index = start + 2;
  while (index < chars.length && !/[@-~]/.test(chars[index] ?? "")) index++;
  return Math.min(index, chars.length - 1);
}

export function terminalPrompt(input: PromptInput, output: PromptOutput): Prompt {
  const decoder = new TextDecoder();
  let pending = "";
  let ended = false;
  let wake: (() => void) | undefined;
  let listening = false;

  function listen() {
    if (listening) return;
    listening = true;
    input.on("data", (chunk) => {
      pending += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      wake?.();
    });
    input.on("end", () => {
      ended = true;
      wake?.();
    });
  }

  const more = () =>
    new Promise<void>((resolve) => {
      wake = () => {
        wake = undefined;
        resolve();
      };
    });

  /** Reads a typed line in raw mode: Enter ends it, Backspace edits it, nothing is echoed. */
  async function rawLine(): Promise<string | undefined> {
    let typed: string[] = [];
    for (;;) {
      const chars = [...pending];
      pending = "";
      for (let index = 0; index < chars.length; index++) {
        const char = chars[index] ?? "";
        if (char === "\r" || char === "\n") {
          pending = chars.slice(index + 1).join("");
          return typed.join("");
        }
        if (char === CTRL_C) throw new PromptCancelledError();
        if (char === CTRL_D && typed.length === 0) return undefined;
        if (BACKSPACES.has(char)) typed = typed.slice(0, -1);
        else if (char === ESCAPE) index = escapeEnd(chars, index);
        else if (char >= " ") typed.push(char);
      }
      if (ended) return typed.length > 0 ? typed.join("") : undefined;
      await more();
    }
  }

  /** Reads one line from a pipe; a last line without a newline counts. */
  async function pipedLine(): Promise<string | undefined> {
    for (;;) {
      const newline = pending.indexOf("\n");
      if (newline >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        return line.endsWith("\r") ? line.slice(0, -1) : line;
      }
      if (ended) {
        const last = pending;
        pending = "";
        return last === "" ? undefined : last;
      }
      await more();
    }
  }

  return {
    async ask(question) {
      const raw = input.isTTY === true && typeof input.setRawMode === "function";
      output.write(question);
      if (raw) input.setRawMode?.(true);
      listen();
      input.resume();
      try {
        return await (raw ? rawLine() : pipedLine());
      } finally {
        if (raw) input.setRawMode?.(false);
        input.pause();
        output.write("\n");
      }
    },
  };
}
