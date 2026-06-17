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
import { promoteScenarioToBase } from "@/lib/scenario/promote-to-base";
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
  const acc = await verifyClientAccess(clientId);
  const ok = acc.ok && acc.firmId === firmId;
  if (!ok) return { error: "Client not found or access denied." };
  return { firmId };
}

export function buildScenarioWriteTools({
  ctx,
}: CopilotToolContext): StructuredToolInterface[] {
  const createScenario = tool(
    async ({ name, copyFrom }) => {
      try {
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
      } catch {
        return "Sorry — that action couldn't be completed.";
      }
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
      targetKind: z.string().describe("entity kind, e.g. account | income | roth_conversion"),
      targetId: z.string().describe("id of the existing base row to edit"),
      desiredFields: z
        .record(z.string(), z.unknown())
        .describe("field → desired value; only changed fields are written"),
    }),
    z.object({
      opType: z.literal("remove"),
      targetKind: z.string().describe("entity kind, e.g. account | income | roth_conversion"),
      targetId: z.string().describe("id of the base row to remove in this scenario"),
    }),
  ]);

  const proposeChanges = tool(
    async ({ scenarioId, groupName, changes }) => {
      try {
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

        // Apply the whole proposal ATOMICALLY: mint ONE toggle group (default-on
        // so the advisor sees its effect immediately; they can switch it off),
        // then apply every change on the SAME transaction. If any change fails
        // mid-batch, the toggle group AND every prior change roll back together —
        // no orphaned group, no half-applied proposal. The write_approved audit
        // fires only AFTER the batch commits, so it can never record a write that
        // didn't actually persist.
        const applied: string[] = [];
        await db.transaction(async (tx) => {
          const [group] = await tx
            .insert(scenarioToggleGroups)
            .values({
              scenarioId,
              name: groupName,
              defaultOn: true,
              requiresGroupId: null,
              orderIndex: 0,
            })
            .returning();
          if (!group) throw new Error("toggle group insert returned no row");
          const toggleGroupId = group.id;

          for (const c of changes) {
            const targetKind = c.targetKind as TargetKind;
            if (c.opType === "add") {
              const entity = { ...(c.entity as Record<string, unknown>), id: c.targetId } as {
                id: string;
                [k: string]: unknown;
              };
              await applyEntityAdd({ scenarioId, firmId, targetKind, entity, toggleGroupId, tx });
              applied.push(`add ${c.targetKind}`);
            } else if (c.opType === "edit") {
              await applyEntityEdit({
                scenarioId,
                firmId,
                targetKind,
                targetId: c.targetId,
                desiredFields: c.desiredFields as Record<string, unknown>,
                toggleGroupId,
                tx,
              });
              applied.push(`edit ${c.targetKind}`);
            } else {
              await applyEntityRemove({ scenarioId, firmId, targetKind, targetId: c.targetId, toggleGroupId, tx });
              applied.push(`remove ${c.targetKind}`);
            }
          }
        });

        await recordAudit({
          action: "copilot.write_approved",
          resourceType: "scenario",
          resourceId: scenarioId,
          clientId: ctx.clientId,
          firmId,
          metadata: { tool: "propose_changes", groupName, count: changes.length, applied },
        });

        return `Applied ${changes.length} change${changes.length === 1 ? "" : "s"} to scenario ${scenarioId} under "${groupName}".`;
      } catch {
        return "Sorry — that action couldn't be completed.";
      }
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

  const revertChangeTool = tool(
    async ({ scenarioId, targetKind, targetId, opType }) => {
      try {
        const gate = await gateAccess(ctx.clientId);
        if ("error" in gate) return gate.error;
        const { firmId } = gate;

        // Pin the scenario to this client BEFORE handing it to revertChange.
        // revertChange's internal assert checks firm scope only, so without this
        // a client-pinned turn could delete a change row on another client's
        // scenario in the same firm (and misattribute the audit to ctx.clientId).
        const [row] = await db
          .select({ id: scenarios.id })
          .from(scenarios)
          .where(and(eq(scenarios.id, scenarioId), eq(scenarios.clientId, ctx.clientId)));
        if (!row) return `Scenario ${scenarioId} not found for this client.`;

        await revertChange({
          scenarioId,
          firmId,
          targetKind: targetKind as TargetKind,
          targetId,
          opType: opType as OpType,
        });

        await recordAudit({
          action: "copilot.write_approved",
          resourceType: "scenario",
          resourceId: scenarioId,
          clientId: ctx.clientId,
          firmId,
          metadata: { tool: "revert_change", targetKind, targetId, opType },
        });

        return `Reverted the ${opType} on ${targetKind} ${targetId} in scenario ${scenarioId}.`;
      } catch {
        return "Sorry — that action couldn't be completed.";
      }
    },
    {
      name: "revert_change",
      description:
        "Remove a single previously-proposed change from a scenario, restoring that entity to " +
        "its base value. Identify the change by scenarioId + targetKind + targetId + opType " +
        "(add | edit | remove). " +
        APPROVAL_SUFFIX,
      schema: z.object({
        scenarioId: z
          .string()
          .describe("the scenario containing the change to revert (must belong to this client)"),
        targetKind: z.string().describe("entity kind of the change to revert"),
        targetId: z.string().describe("the change's target id"),
        opType: z.enum(["add", "edit", "remove"]).describe("which op row to delete"),
      }),
    },
  );

  // Resolve a model-supplied ref string ("base" | scenario uuid) into a
  // ScenarioRef. We do NOT accept snapshot/do-nothing refs from the model here
  // — the copilot snapshots live scenarios only.
  const toRef = (raw: string): ScenarioRef => ({
    kind: "scenario",
    id: raw === "base" ? "base" : raw,
    toggleState: {},
  });

  const compareAndSnapshot = tool(
    async ({ name, leftRef, rightRef }) => {
      try {
        const gate = await gateAccess(ctx.clientId);
        if ("error" in gate) return gate.error;
        const { firmId } = gate;

        const left = toRef(leftRef);
        const right = toRef(rightRef);

        // loadProjectionForRef enforces firm scoping on each ref (loadEffectiveTreeForRef
        // throws cross-firm) and proves both are loadable before we freeze them.
        // ScenarioRef is a member of the EstateCompareRef union; the upcast is required
        // by loadProjectionForRef's parameter type.
        await loadProjectionForRef(ctx.clientId, firmId, left as EstateCompareRef);
        await loadProjectionForRef(ctx.clientId, firmId, right as EstateCompareRef);

        const snapshot = await createSnapshot({
          clientId: ctx.clientId,
          firmId,
          leftRef: left,
          rightRef: right,
          name,
          sourceKind: "manual",
          userId: ctx.userId,
        });

        await recordAudit({
          action: "copilot.write_approved",
          resourceType: "scenario_snapshot",
          resourceId: snapshot.id,
          clientId: ctx.clientId,
          firmId,
          metadata: { tool: "compare_and_snapshot", name, leftRef, rightRef },
        });

        return `Saved comparison snapshot "${name}" (id ${snapshot.id}).`;
      } catch {
        return "Sorry — that action couldn't be completed.";
      }
    },
    {
      name: "compare_and_snapshot",
      description:
        "Freeze a comparison between two scenarios into a saved snapshot that survives later " +
        "edits or deletion of the source scenarios. Pass leftRef and rightRef as 'base' or a " +
        "scenario uuid. " +
        APPROVAL_SUFFIX,
      schema: z.object({
        name: z.string().min(1).max(80).describe("name for the saved snapshot"),
        leftRef: z.string().describe("'base' or a scenario uuid for the left side"),
        rightRef: z.string().describe("'base' or a scenario uuid for the right side"),
      }),
    },
  );

  const promoteToBase = tool(
    async ({ scenarioId }) => {
      try {
        const gate = await gateAccess(ctx.clientId);
        if ("error" in gate) return gate.error;
        const { firmId } = gate;

        // Re-verify the scenario belongs to THIS client and capture isBaseCase.
        const [row] = await db
          .select({ id: scenarios.id, name: scenarios.name, isBaseCase: scenarios.isBaseCase })
          .from(scenarios)
          .where(and(eq(scenarios.id, scenarioId), eq(scenarios.clientId, ctx.clientId)));
        if (!row) return `Scenario ${scenarioId} not found for this client.`;
        // REFUSE on base — promoting the base to itself still deletes siblings.
        if (row.isBaseCase) {
          return "That is already the base case — promoting it would delete every other scenario for no change. Refusing.";
        }

        const dateLabel = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const result = await promoteScenarioToBase({
          clientId: ctx.clientId,
          firmId,
          scenarioId,
          scenarioName: row.name,
          toggleState: {},
          userId: ctx.userId,
          dateLabel,
        });

        // write_approved fires HERE (the tool), on real persisted success, with the
        // real resourceId — the inherited single-most-important rule.
        await recordAudit({
          action: "copilot.write_approved",
          resourceType: "scenario",
          resourceId: scenarioId,
          clientId: ctx.clientId,
          firmId,
          metadata: {
            tool: "promote_to_base",
            snapshotId: result.snapshotId,
            deletedScenarioCount: result.deletedScenarioCount,
            dateLabel,
          },
        });

        return `Promoted "${row.name}" to base. Snapshotted the old base (id ${result.snapshotId}) and deleted ${result.deletedScenarioCount} other scenario(s).`;
      } catch {
        return "Sorry — that action couldn't be completed.";
      }
    },
    {
      name: "promote_to_base",
      description:
        "Make a what-if scenario the new base case. DESTRUCTIVE: overwrites the base plan with this scenario's " +
        "changes, auto-snapshots the current base first, and DELETES all other scenarios. Refuses if the target " +
        "is already the base. " +
        APPROVAL_SUFFIX,
      schema: z.object({
        scenarioId: z.string().describe("the scenario uuid to promote to base"),
      }),
    },
  );

  return [createScenario, proposeChanges, revertChangeTool, compareAndSnapshot, promoteToBase];
}
