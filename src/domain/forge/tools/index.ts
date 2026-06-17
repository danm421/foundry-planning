// src/domain/copilot/tools/index.ts
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { ForgeToolContext } from "../context";
import { buildReadTools } from "./read";
import { buildComputeTools } from "./compute";
import { buildWhatIfTools } from "./whatif";
import { buildScenarioWriteTools } from "./scenario-writes";
import { buildDetailWriteTools } from "./detail-writes";
import { buildCrmTools } from "./crm";
import { buildReportTools } from "./report";
import { buildKnowledgeTools } from "./knowledge";

/**
 * Build the tool set for one conversation. EVERY tool closes over `toolCtx` for
 * server-derived scope (firm/client/scenario) + audit — the model supplies only
 * tool arguments, never scope.
 *
 * Phase 1: the read + compute + what-if tools (15 total).
 * Phase 2: adds the 4 scenario write tools (create_scenario, propose_changes,
 * revert_change, compare_and_snapshot) which route through the human-approval
 * gate when called.
 * Phase 3: adds the detail (plan-data) write tools — the expense sub-phase
 * (add_expense, update_expense, remove_expense), the income sub-phase
 * (add_income, update_income, remove_income), the liability sub-phase
 * (add_liability, update_liability, remove_liability), and the account sub-phase
 * (add_account, update_account, remove_account), also HITL-gated.
 * Phase 4: adds the report tool (generate_report) — a NON-destructive enqueue
 * that queues a presentation deck and renders it in the background, so it is NOT
 * in WRITE_TOOL_NAMES and does not route through the approval gate.
 */
export function buildTools(toolCtx: ForgeToolContext): StructuredToolInterface[] {
  return [
    ...buildReadTools(toolCtx),
    ...buildComputeTools(toolCtx),
    ...buildWhatIfTools(toolCtx),
    ...buildScenarioWriteTools(toolCtx),
    ...buildDetailWriteTools(toolCtx),
    ...buildCrmTools(toolCtx),
    ...buildReportTools(toolCtx),
    ...buildKnowledgeTools(toolCtx),
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
  // DESTRUCTIVE scenario write — overwrites the base + deletes all other scenarios
  "promote_to_base",
  // Phase-3 detail (plan-data) writes — expense sub-phase, HITL-gated
  "add_expense",
  "update_expense",
  "remove_expense",
  // Phase-3 detail (plan-data) writes — income sub-phase, HITL-gated
  "add_income",
  "update_income",
  "remove_income",
  // Phase-3 detail (plan-data) writes — liability sub-phase, HITL-gated
  "add_liability",
  "update_liability",
  "remove_liability",
  // Phase-3 detail (plan-data) writes — account sub-phase, HITL-gated
  "add_account",
  "update_account",
  "remove_account",
  // Tier-B CRM destructive / bulk writes — route through HITL approval node
  "crm_delete_note",
  "crm_delete_task",
  "crm_create_tasks",
]);
