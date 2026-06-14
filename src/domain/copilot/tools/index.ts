// src/domain/copilot/tools/index.ts
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { CopilotToolContext } from "../context";

/**
 * Build the tool set for one conversation. EVERY tool closes over `toolCtx` for
 * server-derived scope (firm/client/scenario) + audit — the model supplies only
 * tool arguments, never scope.
 *
 * Phase 0: empty (the graph runs as a pure chat model). Phase 1 adds the
 * read/compute tools; Phase 2 adds the four write tools.
 */
export function buildTools(toolCtx: CopilotToolContext): StructuredToolInterface[] {
  void toolCtx; // referenced by every tool added in Phase 1/2
  return [];
}

/**
 * Names of tools that mutate and therefore route through the human-approval
 * gate (`routeAfterAgent` → `approval`). Phase 2 fills this with:
 *   create_scenario, propose_changes, revert_change, compare_and_snapshot.
 * Empty in Phase 0 → the approval branch is wired but unreachable.
 */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set<string>();
