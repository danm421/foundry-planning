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

  const ChangeSchema = z.discriminatedUnion("opType", [
    z.object({
      opType: z.literal("add"),
      targetKind: z.string().describe("entity kind, e.g. account | income | roth_conversion"),
      targetId: z.string().describe("a fresh uuid for the new entity (also used as entity.id)"),
      entity: z
        .record(z.string(), z.unknown())
        .describe("the full entity payload; must include id matching targetId"),
    }),
    z.object({
      opType: z.literal("edit"),
      targetKind: z.string(),
      targetId: z.string().describe("id of the existing base row to edit"),
      desiredFields: z
        .record(z.string(), z.unknown())
        .describe("field → desired value; only changed fields are written"),
    }),
    z.object({
      opType: z.literal("remove"),
      targetKind: z.string(),
      targetId: z.string().describe("id of the base row to remove in this scenario"),
    }),
  ]);

  const proposeChanges = tool(
    async ({ scenarioId, groupName, changes }) => {
      const gate = await gateAccess(ctx.clientId);
      if ("error" in gate) return gate.error;
      const { firmId } = gate;

      // Confirm the scenario belongs to this client before minting anything.
      // (The changes-writer re-asserts firm scope on every call, but we want a
      // clean rejection before we write a toggle-group row.)
      const [scenarioRow] = await db
        .select({ id: scenarios.id, clientId: scenarios.clientId })
        .from(scenarios)
        .where(and(eq(scenarios.id, scenarioId), eq(scenarios.clientId, ctx.clientId)));
      if (!scenarioRow) return `Scenario ${scenarioId} not found for this client.`;

      // Mint ONE toggle group so the whole proposal toggles as a unit (default-on
      // so the advisor sees its effect immediately; they can switch it off).
      const [group] = await db
        .insert(scenarioToggleGroups)
        .values({
          scenarioId,
          name: groupName,
          defaultOn: true,
          requiresGroupId: null,
          orderIndex: 0,
        })
        .returning();
      const toggleGroupId = group.id;

      const applied: string[] = [];
      for (const c of changes) {
        const targetKind = c.targetKind as TargetKind;
        if (c.opType === "add") {
          const entity = { ...(c.entity as Record<string, unknown>), id: c.targetId } as {
            id: string;
            [k: string]: unknown;
          };
          await applyEntityAdd({ scenarioId, firmId, targetKind, entity, toggleGroupId });
          applied.push(`add ${c.targetKind}`);
        } else if (c.opType === "edit") {
          await applyEntityEdit({
            scenarioId,
            firmId,
            targetKind,
            targetId: c.targetId,
            desiredFields: c.desiredFields as Record<string, unknown>,
            toggleGroupId,
          });
          applied.push(`edit ${c.targetKind}`);
        } else {
          await applyEntityRemove({ scenarioId, firmId, targetKind, targetId: c.targetId, toggleGroupId });
          applied.push(`remove ${c.targetKind}`);
        }
      }

      await recordAudit({
        action: "copilot.write_approved",
        resourceType: "scenario",
        resourceId: scenarioId,
        clientId: ctx.clientId,
        firmId,
        metadata: { tool: "propose_changes", groupName, count: changes.length, applied },
      });

      return `Applied ${changes.length} change${changes.length === 1 ? "" : "s"} to scenario ${scenarioId} under "${groupName}".`;
    },
    {
      name: "propose_changes",
      description:
        "Apply a batch of related what-if changes to an existing scenario, bundled under one " +
        "toggle group so the advisor can switch the whole proposal on/off. Each change is an " +
        "add (full entity), edit (desiredFields), or remove (by id). Use the scenarioId of the " +
        "scenario you want to modify (create one first with create_scenario if needed). " +
        APPROVAL_SUFFIX,
      schema: z.object({
        scenarioId: z.string().describe("the scenario to modify (must belong to this client)"),
        groupName: z
          .string()
          .min(1)
          .max(80)
          .describe("label for the bundled change group, e.g. 'Roth ladder'"),
        changes: z.array(ChangeSchema).min(1).describe("the changes to apply together"),
      }),
    },
  );

  // revert_change, compare_and_snapshot are appended in the following tasks;
  // this array is extended in place.
  return [createScenario, proposeChanges];
}
