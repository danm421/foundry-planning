// src/domain/copilot/tools/index.ts
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { CopilotToolContext } from "../context";
import { buildReadTools } from "./read";
import { buildComputeTools } from "./compute";
import { buildWhatIfTools } from "./whatif";
import { buildScenarioWriteTools } from "./scenario-writes";

/**
 * Build the tool set for one conversation. EVERY tool closes over `toolCtx` for
 * server-derived scope (firm/client/scenario) + audit — the model supplies only
 * tool arguments, never scope.
 *
 * Phase 1: the read + compute + what-if tools (15 total).
 * Phase 2: adds the 4 scenario write tools (create_scenario, propose_changes,
 * revert_change, compare_and_snapshot) which route through the human-approval
 * gate when called.
 */
export function buildTools(toolCtx: CopilotToolContext): StructuredToolInterface[] {
  return [
    ...buildReadTools(toolCtx),
    ...buildComputeTools(toolCtx),
    ...buildWhatIfTools(toolCtx),
    ...buildScenarioWriteTools(toolCtx),
  ];
}

/**
 * Names of tools that mutate and therefore route through the human-approval
 * gate (`routeAfterAgent` → `approval`). Any tool call whose name appears here
 * is held for advisor confirmation before execution.
 */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "create_scenario",
  "propose_changes",
  "revert_change",
  "compare_and_snapshot",
  // Tier-B CRM destructive / bulk writes — route through HITL approval node
  "crm_delete_note",
  "crm_delete_task",
  "crm_create_tasks",
]);
