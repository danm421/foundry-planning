// src/domain/copilot/tools/index.ts
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { CopilotToolContext } from "../context";
import { buildReadTools } from "./read";
import { buildComputeTools } from "./compute";
import { buildWhatIfTools } from "./whatif";

/**
 * Build the tool set for one conversation. EVERY tool closes over `toolCtx` for
 * server-derived scope (firm/client/scenario) + audit — the model supplies only
 * tool arguments, never scope.
 *
 * Phase 1: the read + compute + what-if tools (15 total). No write tools exist
 * until Phase 2, so WRITE_TOOL_NAMES stays empty and routeAfterAgent never
 * routes to the approval node.
 */
export function buildTools(toolCtx: CopilotToolContext): StructuredToolInterface[] {
  return [
    ...buildReadTools(toolCtx),
    ...buildComputeTools(toolCtx),
    ...buildWhatIfTools(toolCtx),
  ];
}

/**
 * Names of tools that mutate and therefore route through the human-approval
 * gate (`routeAfterAgent` → `approval`). Phase 2 fills this with:
 *   create_scenario, propose_changes, revert_change, compare_and_snapshot.
 * Empty in Phase 0 → the approval branch is wired but unreachable.
 */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set<string>();
