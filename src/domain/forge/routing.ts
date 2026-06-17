// src/domain/forge/routing.ts

/** The shape of a tool call we route on — only the name matters. */
export type ToolCallLike = { name: string };

/**
 * Decide the next node after the model speaks.
 *   - no tool calls           → END (the model produced a final answer)
 *   - any WRITE tool call     → approval (human-in-the-loop gate)
 *   - otherwise (reads only)  → tools (auto-execute)
 * Returns the LangGraph END sentinel string `"__end__"` for the END case so the
 * graph's conditional-edge mapping can translate it back to the END symbol.
 */
export function routeAfterAgent(
  toolCalls: ToolCallLike[],
  writeToolNames: ReadonlySet<string>,
): "tools" | "approval" | "__end__" {
  if (toolCalls.length === 0) return "__end__";
  if (toolCalls.some((c) => writeToolNames.has(c.name))) return "approval";
  return "tools";
}
