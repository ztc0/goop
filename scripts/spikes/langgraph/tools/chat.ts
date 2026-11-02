// T14 spike: a minimal OpenAI-compatible chat client over fetch for llama-server v0.8.0.

export type Family = "qwen" | "gpt-oss";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface ToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface BodyOptions {
  /** llama.cpp#19701 fallback: send a tool-call turn with its reasoning but empty content. */
  blankToolCallContent?: boolean;
}

/** Qwen runs with thinking off; gpt-oss needs its reasoning back on tool-call turns (harmony). */
export function buildBody(
  family: Family,
  messages: readonly ChatMessage[],
  tools: readonly ToolSchema[],
  options: BodyOptions = {},
) {
  const shaped = messages.map((message) => {
    const { reasoning_content, ...rest } = message;
    if (family === "qwen" || !reasoning_content) return rest;
    const blank = options.blankToolCallContent && message.tool_calls?.length;
    return { ...rest, ...(blank ? { content: "" } : {}), reasoning_content };
  });
  return {
    messages: shaped as ChatMessage[],
    tools,
    tool_choice: "auto" as const,
    temperature: 0,
    seed: 42,
    ...(family === "qwen" ? { chat_template_kwargs: { enable_thinking: false } } : {}),
  };
}

interface Reply {
  choices: {
    finish_reason?: string;
    message: Omit<Partial<ChatMessage>, "content"> & { content?: string | null };
  }[];
}

export function parseReply(json: Reply): ChatMessage {
  const message = json.choices[0]?.message;
  if (!message) throw new Error("no choices in the reply");
  return {
    role: "assistant",
    content: message.content ?? "",
    ...(message.reasoning_content ? { reasoning_content: message.reasoning_content } : {}),
    ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
  };
}

export function isThinkingConflict(status: number, text: string): boolean {
  return status === 500 && text.includes("Cannot pass both content and thinking");
}

export class ServerError extends Error {
  constructor(
    readonly status: number,
    readonly text: string,
  ) {
    super(`HTTP ${status}: ${text.slice(0, 300)}`);
  }
}

export async function chat(base: string, apiKey: string, body: unknown): Promise<ChatMessage> {
  const response = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new ServerError(response.status, text);
  return parseReply(JSON.parse(text) as Reply);
}
