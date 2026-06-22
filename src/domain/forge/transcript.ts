// src/domain/forge/transcript.ts
import { type BaseMessage } from "@langchain/core/messages";

export type UiMessage = { role: "user" | "assistant"; text: string };

/** Flatten LangChain message content (string or content-part array) to plain text. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        typeof p === "string"
          ? p
          : typeof (p as { text?: unknown })?.text === "string"
            ? (p as { text: string }).text
            : "",
      )
      .join("");
  }
  return "";
}

/**
 * Map a checkpointed message log to the user/assistant bubbles the chat UI
 * renders. Tool calls, tool results, and system messages are internal and
 * dropped; assistant turns that were pure tool-calls (no prose) produce no
 * bubble.
 *
 * Discriminate by `getType()` ("human"/"ai"), NOT `instanceof`: a streaming
 * model's invoke() aggregates token deltas into an `AIMessageChunk`, so that —
 * not a plain `AIMessage` — is what assistant turns are checkpointed as. An
 * `instanceof AIMessage` test misses it (AIMessageChunk extends
 * BaseMessageChunk, not AIMessage), silently dropping every reply on reload.
 */
export function toUiMessages(messages: BaseMessage[]): UiMessage[] {
  const out: UiMessage[] = [];
  for (const m of messages) {
    const role = m.getType();
    if (role === "human") {
      const text = textOf(m.content).trim();
      if (text) out.push({ role: "user", text });
    } else if (role === "ai") {
      const text = textOf(m.content).trim();
      if (text) out.push({ role: "assistant", text });
    }
  }
  return out;
}
