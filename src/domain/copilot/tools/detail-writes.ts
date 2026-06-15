// src/domain/copilot/tools/detail-writes.ts
//
// Phase 3 DETAIL (plan-data) WRITE TOOLS — currently the expense sub-phase
// (add_/update_/remove_expense). These mutate base-case plan data, so they
// route through the human-approval gate (WRITE_TOOL_NAMES) exactly like the
// Phase-2 scenario writes, and they share that surface's security posture:
//
//   • NONE trust `ctx.firmId`. Each re-derives the firmId fresh via
//     requireOrgId() and re-runs verifyClientAccess(ctx.clientId, firmId)
//     BEFORE any mutation — a /resume can arrive on a different session than
//     the one that proposed the write.
//   • The model supplies ONLY the public entity fields; clientId/userId are
//     server-derived from `ctx`.
//   • Every write routes through the shared expense write-cores (the same
//     validation + FK-assert + audit path the API routes use), so route and
//     agent can never drift.
//
// AUDIT ACTOR (deviation from the plan sketch): the core's `actorId` is the
// real Clerk userId (`ctx.userId`), NOT the firm/org id. Recording firmId as
// the actor is a SOC2 regression — the audit row must name the human who acted.
// This matches Phase-2's posture and the live API routes.
//
// Errors are RETURNED as strings (handed verbatim to the model as a
// ToolMessage), never thrown — the core's {ok:false} error passes through.
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import {
  createExpenseForClient,
  updateExpenseForClient,
  deleteExpenseForClient,
} from "@/lib/clients/expenses-writes";
import type { CopilotToolContext } from "../context";

/** Every write tool's description ends with this so the UI can flag approval. */
const APPROVAL_SUFFIX = "Requires human approval.";

/**
 * Re-derive the firmId from the live session and confirm the (server-supplied)
 * clientId belongs to it. Never trust the firmId baked into `ctx` at
 * propose-time — a /resume can come from a different session, so we re-derive +
 * re-verify on every execution.
 */
async function gateAccess(
  clientId: string,
): Promise<{ firmId: string } | { error: string }> {
  const firmId = await requireOrgId();
  const ok = await verifyClientAccess(clientId, firmId);
  if (!ok) return { error: "Client not found or access denied." };
  return { firmId };
}

// The model-supplied public expense fields (clientId/scenarioId come from ctx).
// Mirrors the loose, coercion-tolerant input the API route accepts; the core
// zod-parses it via expenseCreateSchema and applies the FK asserts + defaults.
const expenseFields = {
  startYear: z.number().int().optional().describe("first plan year the expense applies"),
  endYear: z.number().int().optional().describe("last plan year the expense applies"),
  annualAmount: z
    .union([z.number(), z.string()])
    .optional()
    .describe("annual dollar amount (defaults to 0)"),
  growthRate: z
    .union([z.number(), z.string()])
    .optional()
    .describe("annual growth rate, e.g. 0.03 (defaults to 0.03)"),
  growthSource: z
    .enum(["inflation", "custom"])
    .optional()
    .describe("'inflation' to track CPI, else 'custom' grows by growthRate"),
  ownerEntityId: z.string().optional().describe("owning entity id; mutually exclusive with ownerAccountId"),
  ownerAccountId: z.string().optional().describe("owning business-account id; mutually exclusive with ownerEntityId"),
  cashAccountId: z.string().optional().describe("cash account funding this expense"),
  inflationStartYear: z.number().int().optional().describe("year inflation/growth begins applying"),
  deductionType: z.string().optional().describe("tax deduction category, if deductible"),
  endsAtMedicareEligibilityOwner: z
    .enum(["client", "spouse"])
    .nullable()
    .optional()
    .describe("end the expense when this owner reaches Medicare eligibility"),
};

export function buildDetailWriteTools({
  ctx,
}: CopilotToolContext): StructuredToolInterface[] {
  const addExpense = tool(
    async (input) => {
      try {
        const gate = await gateAccess(ctx.clientId);
        if ("error" in gate) return gate.error;

        const r = await createExpenseForClient({
          clientId: ctx.clientId,
          firmId: gate.firmId,
          actorId: ctx.userId,
          input,
        });
        if (!r.ok) return r.error;

        await recordAudit({
          action: "copilot.write_approved",
          resourceType: "expense",
          resourceId: r.resourceId,
          clientId: ctx.clientId,
          firmId: gate.firmId,
          actorId: ctx.userId,
          metadata: { tool: "add_expense", name: r.data.name },
        });

        return `Added expense "${r.data.name}" (id ${r.resourceId}).`;
      } catch {
        return "Sorry — that action couldn't be completed.";
      }
    },
    {
      name: "add_expense",
      description:
        "Add a new expense to the current client's base-case plan. The model supplies the " +
        "expense fields (type + name required); clientId is server-derived. " +
        APPROVAL_SUFFIX,
      schema: z.object({
        type: z.string().min(1).describe("expense category, e.g. 'discretionary'"),
        name: z.string().min(1).describe("display name for the expense"),
        ...expenseFields,
      }),
    },
  );

  const updateExpense = tool(
    async ({ expenseId, ...input }) => {
      try {
        const gate = await gateAccess(ctx.clientId);
        if ("error" in gate) return gate.error;

        const r = await updateExpenseForClient({
          clientId: ctx.clientId,
          firmId: gate.firmId,
          actorId: ctx.userId,
          expenseId,
          input,
        });
        if (!r.ok) return r.error;

        await recordAudit({
          action: "copilot.write_approved",
          resourceType: "expense",
          resourceId: r.resourceId,
          clientId: ctx.clientId,
          firmId: gate.firmId,
          actorId: ctx.userId,
          metadata: { tool: "update_expense", name: r.data.name },
        });

        return `Updated expense "${r.data.name}" (id ${r.resourceId}).`;
      } catch {
        return "Sorry — that action couldn't be completed.";
      }
    },
    {
      name: "update_expense",
      description:
        "Update fields on an existing expense in the current client's base-case plan. Pass the " +
        "expenseId plus only the fields to change. " +
        APPROVAL_SUFFIX,
      schema: z.object({
        expenseId: z.string().describe("id of the expense to update"),
        type: z.string().min(1).optional().describe("expense category, e.g. 'discretionary'"),
        name: z.string().min(1).optional().describe("display name for the expense"),
        ...expenseFields,
      }),
    },
  );

  const removeExpense = tool(
    async ({ expenseId }) => {
      try {
        const gate = await gateAccess(ctx.clientId);
        if ("error" in gate) return gate.error;

        const r = await deleteExpenseForClient({
          clientId: ctx.clientId,
          firmId: gate.firmId,
          actorId: ctx.userId,
          expenseId,
        });
        if (!r.ok) return r.error;

        await recordAudit({
          action: "copilot.write_approved",
          resourceType: "expense",
          resourceId: r.resourceId,
          clientId: ctx.clientId,
          firmId: gate.firmId,
          actorId: ctx.userId,
          metadata: { tool: "remove_expense" },
        });

        return `Removed expense (id ${r.resourceId}).`;
      } catch {
        return "Sorry — that action couldn't be completed.";
      }
    },
    {
      name: "remove_expense",
      description:
        "Remove an expense from the current client's base-case plan by id. Default living-expense " +
        "rows cannot be removed. " +
        APPROVAL_SUFFIX,
      schema: z.object({
        expenseId: z.string().describe("id of the expense to remove"),
      }),
    },
  );

  return [addExpense, updateExpense, removeExpense];
}
