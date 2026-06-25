// src/domain/forge/routing.ts

/** The shape of a tool call we route on — only the name matters. */
export type ToolCallLike = { name: string };

/** The single write tool that routes to the meeting_review interrupt instead of
 *  the generic approval node (it carries an editable summary + task list). */
export const MEETING_REVIEW_TOOL = "save_meeting_record";

/**
 * Decide the next node after the model speaks.
 *   - no tool calls, hasNumber false → END (the model produced a final answer)
 *   - no tool calls, hasNumber true  → verify (final answer with numbers, needs checking)
 *   - save_meeting_record call       → meeting_review (editable summary HITL gate)
 *   - any other WRITE tool call      → approval (human-in-the-loop gate)
 *   - otherwise (reads only)         → tools (auto-execute)
 * Returns the LangGraph END sentinel string `"__end__"` for the END case so the
 * graph's conditional-edge mapping can translate it back to the END symbol.
 */
export function routeAfterAgent(
  toolCalls: ToolCallLike[],
  writeToolNames: ReadonlySet<string>,
  hasNumber: boolean = false,
): "tools" | "approval" | "meeting_review" | "verify" | "__end__" {
  if (toolCalls.length === 0) return hasNumber ? "verify" : "__end__";
  if (toolCalls.some((c) => c.name === MEETING_REVIEW_TOOL)) return "meeting_review";
  if (toolCalls.some((c) => writeToolNames.has(c.name))) return "approval";
  return "tools";
}
