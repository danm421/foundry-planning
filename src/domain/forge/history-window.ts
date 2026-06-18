// src/domain/forge/history-window.ts
import { type BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";

/**
 * How many trailing messages to keep in the model's working context. The FULL
 * history still lives in the checkpointer (for display + audit); this only
 * bounds what we re-send to the model each turn so cost/latency don't grow
 * unbounded.
 */
export const DEFAULT_HISTORY_WINDOW = 40;

/**
 * Pick the recent slice of a conversation to send to the model. We keep the
 * last `maxMessages`, then walk backward to the start of the user turn that
 * contains the cut, so the window always begins on a HumanMessage. That
 * guarantees we never send an orphaned ToolMessage (or an assistant tool_call
 * whose results were cut), which Azure/OpenAI reject with a 400. The cost is
 * occasionally sending a few more than `maxMessages` — correctness over a
 * strict count.
 */
export function selectHistoryWindow(
  messages: BaseMessage[],
  maxMessages: number = DEFAULT_HISTORY_WINDOW,
): BaseMessage[] {
  if (messages.length <= maxMessages) return messages;
  let start = messages.length - maxMessages;
  while (start > 0 && !(messages[start] instanceof HumanMessage)) start--;
  return messages.slice(start);
}

// Numeric facts worth preserving when older turns are trimmed: dollar amounts,
// percentages, and ages. A deterministic regex — no model call, no extra Azure
// cost (an async LLM summary is a possible future enhancement).
const NUMERIC_FACT_RE = /\$[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?%|\bage \d+/gi;

function messageText(m: BaseMessage): string {
  return typeof m.content === "string" ? m.content : "";
}

/**
 * Like selectHistoryWindow, but when older turns fall outside the window it
 * prepends a single SYNTHETIC summary message preserving the numeric facts from
 * the dropped prefix (so the model doesn't lose dollar figures / ages it relied
 * on earlier). The window itself is still boundary-safe (begins on a
 * HumanMessage). No model call — deterministic and cheap enough to run every turn.
 */
export function compactHistory(
  messages: BaseMessage[],
  { windowSize = DEFAULT_HISTORY_WINDOW }: { windowSize?: number } = {},
): BaseMessage[] {
  if (messages.length <= windowSize) return messages;
  const window = selectHistoryWindow(messages, windowSize);
  const droppedCount = messages.length - window.length;
  if (droppedCount <= 0) return window;

  const dropped = messages.slice(0, droppedCount);
  const text = dropped.map(messageText).join(" ");
  const uniqueFacts = [...new Set(text.match(NUMERIC_FACT_RE) ?? [])].slice(0, 40);
  const summary = new SystemMessage(
    `[Earlier context summary] ${droppedCount} earlier message(s) were trimmed to fit the context window. ` +
      `Key figures mentioned earlier: ${uniqueFacts.length ? uniqueFacts.join(", ") : "none"}.`,
  );
  return [summary, ...window];
}
