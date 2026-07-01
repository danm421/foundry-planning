// src/domain/forge/tools/global-actions.ts
//
// GLOBAL (clientless) AGENTIC tools — Plan 2. Firm-scoped via requireOrgId();
// the model never supplies scope. Reads reuse firm-scoped lib queries; writes
// (create_household / set_up_plan / create_task_for_client) are in
// WRITE_TOOL_NAMES → held by the approval node, run only on the resume pass, and
// emit forge.write_approved themselves on real success (mirroring Tier-B CRM tools).
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { listCrmHouseholds } from "@/lib/crm/households";
import type { ForgeGlobalToolContext } from "../context";

export function buildGlobalActionTools({ ctx, conversationId }: ForgeGlobalToolContext): StructuredToolInterface[] {
  const findClient = tool(
    async ({ query }: { query: string }) => {
      try {
        const rows = await listCrmHouseholds({ search: query, limit: 10 });
        const matches = rows.map((h) => ({
          name: h.name,
          householdId: h.id,
          clientId: h.planningClient?.id ?? null,
          status: h.status,
        }));
        return JSON.stringify({ matches });
      } catch (e) {
        return e instanceof Error ? e.message : "Failed to search clients.";
      }
    },
    {
      name: "find_client",
      description:
        "Search this advisor's households/clients by name (case-insensitive). Read-only, firm-scoped. " +
        "Returns up to 10 matches with householdId, clientId (null if no plan yet), and status. " +
        "Use to resolve a name the advisor mentions before open_client or create_task_for_client.",
      schema: z.object({ query: z.string().min(1).describe("a client or household name to search for") }),
    },
  );

  // (unused now; Tasks 2–5 add ctx/conversationId/recordAudit/requireOrgId usages)
  void ctx; void conversationId; void requireOrgId; void recordAudit;

  return [findClient];
}
