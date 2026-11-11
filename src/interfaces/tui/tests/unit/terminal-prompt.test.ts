import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PromptCancelledError, terminalPrompt } from "@/interfaces/tui/adapters/terminal-prompt";

/** A stand-in for stdin: `type` delivers a chunk, `end` closes it; raw mode is recorded. */
function fakeInput(isTTY: boolean) {
  const emitter = new EventEmitter();
  const state = { raw: [] as boolean[], paused: true };
  const input = {
    isTTY,
    setRawMode(mode: boolean) {
      state.raw.push(mode);
    },
    on: (event: "data" | "end", listener: (chunk: string | Uint8Array) => void) => {
      emitter.on(event, listener);
    },
    pause() {
      state.paused = true;
    },
    resume() {
      state.paused = false;
    },
  };
  return {
    input,
    state,
    type: (text: string | Uint8Array) => emitter.emit("data", text),
    end: () => emitter.emit("end"),
  };
}

function fakeOutput() {
  const written: string[] = [];
  return { written, output: { write: (text: string) => written.push(text) } };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("terminalPrompt on a terminal (no echo)", () => {
  test("reads one line in raw mode, echoes nothing and leaves raw mode", async () => {
    const stdin = fakeInput(true);
    const { written, output } = fakeOutput();
    const prompt = terminalPrompt(stdin.input, output);

    const answer = prompt.ask("Passphrase: ");
    await tick();
    for (const char of "hunter2") stdin.type(char);
    stdin.type("\r");

    expect(await answer).toBe("hunter2");
    expect(written).toEqual(["Passphrase: ", "\n"]);
    expect(stdin.state).toEqual({ raw: [true, false], paused: true });
  });

  test("backspace removes the last character, and arrow keys are ignored", async () => {
    const stdin = fakeInput(true);
    const prompt = terminalPrompt(stdin.input, fakeOutput().output);

    const answer = prompt.ask("Passphrase: ");
    stdin.type("hunter3");
    stdin.type("\u007f");
    stdin.type("\u001b[D");
    stdin.type("2ñ\b\r");

    expect(await answer).toBe("hunter2");
  });

  test("Ctrl-C cancels and still leaves raw mode", async () => {
    const stdin = fakeInput(true);
    const { written, output } = fakeOutput();
    const prompt = terminalPrompt(stdin.input, output);

    const answer = prompt.ask("Passphrase: ");
    stdin.type("hun\u0003");

    expect(await answer.catch((error: unknown) => error)).toBeInstanceOf(PromptCancelledError);
    expect(stdin.state.raw).toEqual([true, false]);
    expect(written).toEqual(["Passphrase: ", "\n"]);
  });

  test("Ctrl-D on an empty line is no answer", async () => {
    const stdin = fakeInput(true);
    const prompt = terminalPrompt(stdin.input, fakeOutput().output);

    const answer = prompt.ask("Passphrase: ");
    stdin.type("\u0004");

    expect(await answer).toBeUndefined();
  });

  test("a failure after entering raw mode still leaves raw mode", async () => {
    const stdin = fakeInput(true);
    stdin.input.resume = () => {
      throw new Error("read failed");
    };
    const { written, output } = fakeOutput();

    await expect(terminalPrompt(stdin.input, output).ask("Passphrase: ")).rejects.toThrow(
      "read failed",
    );
    expect(stdin.state).toEqual({ raw: [true, false], paused: true });
    expect(written).toEqual(["Passphrase: ", "\n"]);
  });
});

describe("terminalPrompt on a pipe", () => {
  test("reads one line per question, in order, from chunks split anywhere", async () => {
    const stdin = fakeInput(false);
    const { written, output } = fakeOutput();
    const prompt = terminalPrompt(stdin.input, output);

    const first = prompt.ask("Passphrase: ");
    stdin.type("first pass");
    stdin.type(new TextEncoder().encode("phrase ñ\r\nsecond"));
    expect(await first).toBe("first passphrase ñ");
    const second = prompt.ask("Passphrase again: ");
    stdin.type(" one\n");

    expect(await second).toBe("second one");
    expect(written).toEqual(["Passphrase: ", "\n", "Passphrase again: ", "\n"]);
    expect(stdin.state.raw).toEqual([]);
  });

  test("a last line without a newline counts; after the end there is no answer", async () => {
    const stdin = fakeInput(false);
    const prompt = terminalPrompt(stdin.input, fakeOutput().output);

    const first = prompt.ask("Passphrase: ");
    stdin.type("last");
    stdin.end();

    expect(await first).toBe("last");
    expect(await prompt.ask("Passphrase again: ")).toBeUndefined();
  });

  test("an empty input is no answer", async () => {
    const stdin = fakeInput(false);
    const prompt = terminalPrompt(stdin.input, fakeOutput().output);

    const answer = prompt.ask("Passphrase: ");
    stdin.end();

    expect(await answer).toBeUndefined();
  });
});
