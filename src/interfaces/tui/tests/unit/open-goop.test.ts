import { describe, expect, test } from "bun:test";
import type { Prompt } from "@/interfaces/tui/adapters/terminal-prompt";
import { PromptCancelledError } from "@/interfaces/tui/adapters/terminal-prompt";
import { openGoop } from "@/interfaces/tui/services/open-goop";
import {
  type Channel,
  ChannelError,
  type ChannelEvents,
  type JsonRpcErrorObject,
  type JsonRpcMessage,
  type JsonRpcRequest,
} from "@/shared/ipc";

const PASSPHRASE = "passphrase-SECRET-0001";
const RECOVERY_KEY = "0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV-WXYZ";
const WRONG_SECRET = { code: 1001, message: "The passphrase or recovery key is not right." };
const PONG = "goop daemon answered: pong";

type Handler = (request: JsonRpcRequest) => { result: unknown } | { error: JsonRpcErrorObject };

/** An in-memory daemon: `handle` answers each request; `undefined` means no answer at all. */
function fakeDaemon(handle: (request: JsonRpcRequest) => ReturnType<Handler> | undefined) {
  const state = { sent: [] as JsonRpcRequest[], closed: false };
  const channel: Channel = {
    listen: () => Promise.reject(new Error("the TUI never listens")),
    async connect(events: ChannelEvents) {
      return {
        send(message: JsonRpcMessage) {
          const request = message as JsonRpcRequest;
          state.sent.push(request);
          const reply = handle(request);
          if (reply) {
            queueMicrotask(() =>
              events.message({ ok: true, message: { jsonrpc: "2.0", id: request.id, ...reply } }),
            );
          }
        },
        close() {
          state.closed = true;
        },
      };
    },
  };
  return { channel, state };
}

/** A daemon whose vault is in `status`; `answers` gives the vault methods' replies. */
function vaultDaemon(status: string, answers: Partial<Record<string, ReturnType<Handler>>> = {}) {
  return fakeDaemon((request) => {
    if (request.method === "ping") return { result: "pong" };
    if (request.method === "vault.status") return { result: { state: status } };
    return answers[request.method] ?? { error: { code: -32601, message: "Method not found" } };
  });
}

/** Answers each question in turn, and records the questions. */
function scriptedPrompt(answers: (string | undefined | Error)[]) {
  const questions: string[] = [];
  const prompt: Prompt = {
    async ask(question) {
      questions.push(question);
      const answer = answers.shift();
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { prompt, questions };
}

function recordOutput() {
  const lines = { stdout: [] as string[], stderr: [] as string[] };
  return {
    lines,
    output: {
      print: (line: string) => lines.stdout.push(line),
      fail: (line: string) => lines.stderr.push(line),
    },
  };
}

const methods = (sent: JsonRpcRequest[]) => sent.map((request) => request.method);

/** No line goop printed holds a secret it was given or sent. */
function expectNoSecretPrinted(lines: { stdout: string[]; stderr: string[] }) {
  for (const line of [...lines.stdout, ...lines.stderr]) {
    expect(line).not.toContain(PASSPHRASE);
    expect(line).not.toContain("SECRET");
  }
}

describe("openGoop: an unlocked vault (daemon-ipc T3 behavior)", () => {
  test("asks nothing, pings and prints the answer", async () => {
    const { channel, state } = vaultDaemon("unlocked");
    const { prompt, questions } = scriptedPrompt([]);
    const { lines, output } = recordOutput();

    expect(await openGoop(() => channel, output, prompt)).toBe(0);
    expect(lines).toEqual({ stdout: [PONG], stderr: [] });
    expect(questions).toEqual([]);
    expect(methods(state.sent)).toEqual(["vault.status", "ping"]);
    expect(state.closed).toBe(true);
  });

  test("no daemon: says how to start it and returns 1, asking nothing", async () => {
    const channel: Channel = {
      listen: () => Promise.reject(new Error("the TUI never listens")),
      connect: () => Promise.reject(new ChannelError("goop daemon is not running")),
    };
    const { prompt, questions } = scriptedPrompt([]);
    const { lines, output } = recordOutput();

    expect(await openGoop(() => channel, output, prompt)).toBe(1);
    expect(lines).toEqual({
      stdout: [],
      stderr: ["goop daemon is not running. Start it in another terminal with: goop daemon"],
    });
    expect(questions).toEqual([]);
  });

  test("a channel that cannot be opened: prints its reason and returns 1", async () => {
    const { lines, output } = recordOutput();
    const openChannel = () => {
      throw new ChannelError("No runtime folder: set GOOP_RUNTIME_DIR or XDG_RUNTIME_DIR");
    };

    expect(await openGoop(openChannel, output, scriptedPrompt([]).prompt)).toBe(1);
    expect(lines.stderr).toEqual(["No runtime folder: set GOOP_RUNTIME_DIR or XDG_RUNTIME_DIR"]);
  });

  test("no answer in time: says so, closes the connection and returns 1", async () => {
    const { channel, state } = fakeDaemon(() => undefined);
    const { lines, output } = recordOutput();

    expect(await openGoop(() => channel, output, scriptedPrompt([]).prompt, { replyMs: 20 })).toBe(
      1,
    );
    expect(lines).toEqual({ stdout: [], stderr: ["goop daemon did not answer within 20 ms."] });
    expect(state.closed).toBe(true);
  });

  test("a status goop cannot read is refused without showing it", async () => {
    const { channel } = vaultDaemon("\u001b[2Jopen");
    const { lines, output } = recordOutput();

    expect(await openGoop(() => channel, output, scriptedPrompt([]).prompt)).toBe(1);
    expect(lines).toEqual({ stdout: [], stderr: ["goop daemon gave an unexpected answer."] });
  });
});

describe("openGoop: a locked vault (daemon-ipc S7)", () => {
  test("asks for the passphrase, sends it once to vault.unlock, then pings", async () => {
    const { channel, state } = vaultDaemon("locked", {
      "vault.unlock": { result: { state: "unlocked" } },
    });
    const { prompt, questions } = scriptedPrompt([PASSPHRASE]);
    const { lines, output } = recordOutput();

    expect(await openGoop(() => channel, output, prompt)).toBe(0);
    expect(questions).toEqual(["Passphrase: "]);
    expect(state.sent[1]).toEqual({
      jsonrpc: "2.0",
      id: 2,
      method: "vault.unlock",
      params: { passphrase: PASSPHRASE },
    });
    expect(methods(state.sent)).toEqual(["vault.status", "vault.unlock", "ping"]);
    expect(lines).toEqual({ stdout: [PONG], stderr: [] });
  });

  test("a wrong passphrase: one fixed line, exit 1, no ping", async () => {
    const { channel, state } = vaultDaemon("locked", { "vault.unlock": { error: WRONG_SECRET } });
    const { lines, output } = recordOutput();

    expect(await openGoop(() => channel, output, scriptedPrompt([PASSPHRASE]).prompt)).toBe(1);
    expect(lines).toEqual({
      stdout: [],
      stderr: ["The passphrase or recovery key is not right. Nothing was changed."],
    });
    expect(methods(state.sent)).toEqual(["vault.status", "vault.unlock"]);
    expectNoSecretPrinted(lines);
  });

  test.each([
    [undefined, "Nothing was typed. Nothing was changed."],
    ["", "Nothing was typed. Nothing was changed."],
    ["x".repeat(1025), "The passphrase is longer than 1024 characters. Nothing was changed."],
  ])("typing %j sends nothing and exits 1", async (typed, problem) => {
    const { channel, state } = vaultDaemon("locked");
    const { lines, output } = recordOutput();

    expect(await openGoop(() => channel, output, scriptedPrompt([typed]).prompt)).toBe(1);
    expect(lines).toEqual({ stdout: [], stderr: [problem] });
    expect(methods(state.sent)).toEqual(["vault.status"]);
  });

  test("Ctrl-C at the prompt cancels, sends nothing and exits 130", async () => {
    const { channel, state } = vaultDaemon("locked");
    const { lines, output } = recordOutput();

    expect(
      await openGoop(() => channel, output, scriptedPrompt([new PromptCancelledError()]).prompt),
    ).toBe(130);
    expect(lines).toEqual({ stdout: [], stderr: ["Cancelled."] });
    expect(methods(state.sent)).toEqual(["vault.status"]);
    expect(state.closed).toBe(true);
  });

  test("the vault changed state meanwhile: names the state, never the daemon's text", async () => {
    const { channel } = vaultDaemon("locked", {
      "vault.unlock": {
        error: { code: 1002, message: "\u001b[2J anything", data: { state: "unlocked" } },
      },
    });
    const { lines, output } = recordOutput();

    expect(await openGoop(() => channel, output, scriptedPrompt([PASSPHRASE]).prompt)).toBe(1);
    expect(lines.stderr).toEqual(["The vault is unlocked now. Run goop again."]);
  });
});

describe("openGoop: a first run (daemon-ipc S7)", () => {
  test("asks for the passphrase twice, sets the vault up and shows the recovery key once", async () => {
    const { channel, state } = vaultDaemon("first-run", {
      "vault.setup": { result: { recoveryKey: RECOVERY_KEY } },
    });
    const { prompt, questions } = scriptedPrompt([PASSPHRASE, PASSPHRASE]);
    const { lines, output } = recordOutput();

    expect(await openGoop(() => channel, output, prompt)).toBe(0);
    expect(questions).toEqual(["Passphrase: ", "Passphrase again: "]);
    expect(state.sent[1]).toEqual({
      jsonrpc: "2.0",
      id: 2,
      method: "vault.setup",
      params: { passphrase: PASSPHRASE },
    });
    expect(lines).toEqual({
      stdout: [
        "goop has no vault yet. Choose a passphrase to protect it.",
        "Your recovery key:",
        `    ${RECOVERY_KEY}`,
        "Write it down now and keep it somewhere safe: goop shows it only this once, and it is the only way back in if the passphrase is lost.",
        PONG,
      ],
      stderr: [],
    });
    expect(lines.stdout.filter((line) => line.includes(RECOVERY_KEY))).toHaveLength(1);
    expectNoSecretPrinted(lines);
  });

  test("two different passphrases: nothing is sent, exit 1", async () => {
    const { channel, state } = vaultDaemon("first-run");
    const { lines, output } = recordOutput();

    expect(
      await openGoop(() => channel, output, scriptedPrompt([PASSPHRASE, `${PASSPHRASE}x`]).prompt),
    ).toBe(1);
    expect(lines.stderr).toEqual(["The two passphrases are not the same. Nothing was changed."]);
    expect(methods(state.sent)).toEqual(["vault.status"]);
    expectNoSecretPrinted(lines);
  });

  test("a recovery key goop cannot read is never shown, and goop says to start over", async () => {
    const { channel } = vaultDaemon("first-run", {
      "vault.setup": { result: { recoveryKey: "\u001b[2J" } },
    });
    const { lines, output } = recordOutput();

    expect(
      await openGoop(() => channel, output, scriptedPrompt([PASSPHRASE, PASSPHRASE]).prompt),
    ).toBe(1);
    expect(lines.stderr).toEqual(["goop daemon gave an unexpected answer."]);
    expect(lines.stdout.join("")).not.toContain("\u001b");
  });
});

describe("openGoop: a vault that needs its recovery key (daemon-ipc S7)", () => {
  test("asks for the recovery key and a new passphrase twice, then recovers", async () => {
    const { channel, state } = vaultDaemon("needs-recovery", {
      "vault.recover": { result: { state: "unlocked" } },
    });
    const { prompt, questions } = scriptedPrompt([RECOVERY_KEY, PASSPHRASE, PASSPHRASE]);
    const { lines, output } = recordOutput();

    expect(await openGoop(() => channel, output, prompt)).toBe(0);
    expect(questions).toEqual(["Recovery key: ", "New passphrase: ", "New passphrase again: "]);
    expect(state.sent[1]).toEqual({
      jsonrpc: "2.0",
      id: 2,
      method: "vault.recover",
      params: { recoveryKey: RECOVERY_KEY, passphrase: PASSPHRASE },
    });
    expect(lines).toEqual({
      stdout: [
        "The vault's usual key cannot open it here. Type the recovery key you wrote down, then choose a new passphrase.",
        PONG,
      ],
      stderr: [],
    });
  });

  test("a wrong recovery key: the same fixed line, exit 1", async () => {
    const { channel } = vaultDaemon("needs-recovery", { "vault.recover": { error: WRONG_SECRET } });
    const { lines, output } = recordOutput();

    expect(
      await openGoop(
        () => channel,
        output,
        scriptedPrompt([RECOVERY_KEY, PASSPHRASE, PASSPHRASE]).prompt,
      ),
    ).toBe(1);
    expect(lines.stderr).toEqual([
      "The passphrase or recovery key is not right. Nothing was changed.",
    ]);
    expect([...lines.stdout, ...lines.stderr].join("\n")).not.toContain(RECOVERY_KEY);
  });
});
