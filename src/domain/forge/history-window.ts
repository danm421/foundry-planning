// src/domain/copilot/history-window.ts
import { type BaseMessage, HumanMessage } from "@langchain/core/messages";

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
