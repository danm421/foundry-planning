// src/domain/copilot/tools/scenario-writes.ts
//
// Phase 2 SCENARIO WRITE TOOLS — the highest-risk copilot surface. Every tool
// here executes POST-APPROVAL, on a /resume request that may originate in a
// different session than the one that proposed the write. So NONE of them trust
// `ctx.firmId`: each re-derives the firmId fresh via `requireOrgId()` and
// re-runs `verifyClientAccess(ctx.clientId, firmId)` before any mutation. The
// model never supplies scope (clientId/userId are server-derived from `ctx`);
// it supplies only scenarioId/name/copyFrom/changes/refs, and every model-
// supplied id is validated against `ctx.clientId` before use.
//
// All writes route through the sanctioned helpers (create-with-clone /
// changes-writer / snapshot) — never a raw `db.insert`, with the lone exception
// of minting the toggle-group row in `propose_changes`. Errors are RETURNED as
// strings (handed verbatim to the model as a ToolMessage), never thrown.
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios, scenarioToggleGroups } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import {
  createScenarioWithClone,
  type CreateWithCloneSource,
} from "@/lib/scenario/create-with-clone";
import {
  applyEntityAdd,
  applyEntityEdit,
  applyEntityRemove,
  revertChange,
} from "@/lib/scenario/changes-writer";
import { createSnapshot } from "@/lib/scenario/snapshot";
import { loadProjectionForRef } from "@/lib/scenario/load-projection-for-ref";
import type { ScenarioRef } from "@/lib/scenario/loader";
import type { EstateCompareRef } from "@/lib/scenario/scenario-from-search-params";
import type { TargetKind, OpType } from "@/engine/scenario/types";
import type { CopilotToolContext } from "../context";

/** Every write tool's description ends with this so the UI can flag approval. */
const APPROVAL_SUFFIX = "Requires human approval.";

/**
 * Re-derive the firmId from the live session and confirm the (server-supplied)
 * clientId belongs to it. The whole point of this surface: never trust the
 * firmId baked into `ctx` at propose-time — a /resume can come from a different
 * session, so we re-derive + re-verify on every execution.
 */
async function gateAccess(
  clientId: string,
): Promise<{ firmId: string } | { error: string }> {
  const firmId = await requireOrgId();
  const ok = await verifyClientAccess(clientId, firmId);
  if (!ok) return { error: "Client not found or access denied." };
  return { firmId };
}

export function buildScenarioWriteTools({
  ctx,
}: CopilotToolContext): StructuredToolInterface[] {
  const createScenario = tool(
    async ({ name, copyFrom }) => {
      const gate = await gateAccess(ctx.clientId);
      if ("error" in gate) return gate.error;
      const { firmId } = gate;

      // Resolve the source. `copyFrom` is model-supplied — when it's a uuid we
      // re-verify it points at a scenario owned by THIS client before cloning,
      // so a copilot can't seed a new scenario from another client's data.
      let source: CreateWithCloneSource;
      if (copyFrom == null || copyFrom === "empty") {
        source = { kind: "empty" };
      } else if (copyFrom === "base") {
        source = { kind: "base" };
      } else {
        const [sourceRow] = await db
          .select({ id: scenarios.id })
          .from(scenarios)
          .where(and(eq(scenarios.id, copyFrom), eq(scenarios.clientId, ctx.clientId)));
        if (!sourceRow) return `Source scenario ${copyFrom} not found for this client.`;
        source = { kind: "scenario", sourceId: copyFrom };
      }

      const { scenario } = await createScenarioWithClone({
        clientId: ctx.clientId,
        name,
        source,
      });

      await recordAudit({
        action: "scenario.create",
        resourceType: "scenario",
        resourceId: scenario.id,
        clientId: ctx.clientId,
        firmId,
        metadata: { tool: "create_scenario", name, copyFrom: copyFrom ?? "empty" },
      });
      await recordAudit({
        action: "copilot.write_approved",
        resourceType: "scenario",
        resourceId: scenario.id,
        clientId: ctx.clientId,
        firmId,
        metadata: { tool: "create_scenario", name, copyFrom: copyFrom ?? "empty" },
      });

      return `Created scenario "${scenario.name}" (id ${scenario.id}).`;
    },
    {
      name: "create_scenario",
      description:
        "Create a new what-if scenario for the current client, optionally seeded from the base " +
        "case or an existing scenario. Pass copyFrom as 'base', 'empty' (or omit), or an " +
        "existing scenario uuid to clone its changes. " +
        APPROVAL_SUFFIX,
      schema: z.object({
        name: z.string().min(1).max(80).describe("display name for the new scenario"),
        copyFrom: z
          .string()
          .optional()
          .describe("'base' | 'empty' | a scenario uuid to clone; omit for empty"),
      }),
    },
  );

  // propose_changes, revert_change, compare_and_snapshot are appended in the
  // following tasks; this array is extended in place.
  return [createScenario];
}
