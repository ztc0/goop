import { describe, expect, test } from "bun:test";
import { buildBody, type ChatMessage, isThinkingConflict, parseReply } from "../chat";

const call = {
  id: "c1",
  type: "function" as const,
  function: { name: "get_offer", arguments: "{}" },
};
const history: ChatMessage[] = [
  { role: "user", content: "hi" },
  {
    role: "assistant",
    content: "Let me look.",
    reasoning_content: "Need a tool.",
    tool_calls: [call],
  },
  { role: "tool", tool_call_id: "c1", content: "{}" },
];

describe("buildBody", () => {
  test("qwen turns thinking off and drops reasoning from the history", () => {
    const body = buildBody("qwen", history, []);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.tool_choice).toBe("auto");
    expect(body.temperature).toBe(0);
    expect(body.messages[1]).toEqual({
      role: "assistant",
      content: "Let me look.",
      tool_calls: [call],
    });
  });

  test("gpt-oss sends the reasoning of the assistant turn back, without template kwargs", () => {
    const body = buildBody("gpt-oss", history, []);
    expect(body.chat_template_kwargs).toBeUndefined();
    expect(body.messages[1]?.reasoning_content).toBe("Need a tool.");
    expect(body.messages[1]?.content).toBe("Let me look.");
  });

  test("the #19701 fallback blanks content on tool-call turns that also carry reasoning", () => {
    const body = buildBody("gpt-oss", history, [], { blankToolCallContent: true });
    expect(body.messages[1]).toEqual({
      role: "assistant",
      content: "",
      reasoning_content: "Need a tool.",
      tool_calls: [call],
    });
    expect(body.messages[0]).toEqual(history[0] as ChatMessage);
  });
});

describe("parseReply", () => {
  test("reads content, tool calls and reasoning from the first choice", () => {
    const reply = parseReply({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            reasoning_content: "think",
            tool_calls: [call],
          },
        },
      ],
    });
    expect(reply).toEqual({
      role: "assistant",
      content: "",
      reasoning_content: "think",
      tool_calls: [call],
    });
  });

  test("a reply without choices is an error", () => {
    expect(() => parseReply({ choices: [] })).toThrow("no choices in the reply");
  });
});

test("isThinkingConflict spots the llama.cpp#19701 template error only on HTTP 500", () => {
  const text =
    '{"error":{"message":"Cannot pass both content and thinking in an assistant message"}}';
  expect(isThinkingConflict(500, text)).toBe(true);
  expect(isThinkingConflict(400, text)).toBe(false);
  expect(isThinkingConflict(500, "other")).toBe(false);
});
