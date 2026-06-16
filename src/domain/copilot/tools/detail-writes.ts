// src/domain/copilot/tools/detail-writes.ts
//
// Phase 3 DETAIL (plan-data) WRITE TOOLS — the expense sub-phase
// (add_/update_/remove_expense), the income sub-phase
// (add_/update_/remove_income), and the liability sub-phase
// (add_/update_/remove_liability). These mutate base-case plan data, so they
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
import {
  createIncomeForClient,
  updateIncomeForClient,
  deleteIncomeForClient,
} from "@/lib/clients/incomes-writes";
import {
  createLiabilityForClient,
  updateLiabilityForClient,
  deleteLiabilityForClient,
} from "@/lib/clients/liabilities-writes";
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

// The model-supplied public income fields (clientId/scenarioId come from ctx).
// Mirrors the loose, coercion-tolerant input the API route accepts; the core
// zod-parses it via incomeCreateSchema and applies the FK asserts + defaults.
// NOTE: income-specific — has owner/claiming/SS fields but NO deductionType or
// endsAtMedicareEligibilityOwner (those are expense-only).
const incomeFields = {
  startYear: z.number().int().optional().describe("first plan year the income applies"),
  endYear: z.number().int().optional().describe("last plan year the income applies"),
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
  owner: z.string().optional().describe("income owner, e.g. 'client' or 'spouse' (defaults to 'client')"),
  claimingAge: z
    .union([z.number(), z.string()])
    .optional()
    .describe("Social Security claiming age, if applicable"),
  taxType: z.string().optional().describe("tax treatment of this income, if applicable"),
  ssBenefitMode: z.string().optional().describe("Social Security benefit calculation mode"),
  piaMonthly: z
    .union([z.number(), z.string()])
    .optional()
    .describe("primary insurance amount (monthly), for Social Security"),
  claimingAgeMonths: z
    .union([z.number(), z.string()])
    .optional()
    .describe("additional months past the claiming-age year"),
  claimingAgeMode: z.string().optional().describe("how the claiming age is interpreted"),
  ownerEntityId: z.string().optional().describe("owning entity id; mutually exclusive with ownerAccountId"),
  ownerAccountId: z.string().optional().describe("owning business-account id; mutually exclusive with ownerEntityId"),
  cashAccountId: z.string().optional().describe("cash account this income flows into"),
};

// The model-supplied public liability fields (clientId/scenarioId come from ctx).
// Mirrors the loose, coercion-tolerant input the API route accepts; the core
// zod-parses it via liabilityCreateSchema and applies the FK asserts + defaults.
// startYear/termMonths are kept .optional() here (matching expenseFields.startYear)
// — the add tool re-requires them; the core's liabilityCreateSchema enforces
// required-ness once for all callers. (The internal startYearRef ref token is NOT
// exposed — expenseFields/incomeFields omit their refs too.)
const liabilityFields = {
  startYear: z.number().int().optional().describe("first plan year the liability applies"),
  termMonths: z.number().int().optional().describe("loan term in months"),
  balance: z
    .union([z.number(), z.string()])
    .optional()
    .describe("outstanding balance (defaults to 0)"),
  interestRate: z
    .union([z.number(), z.string()])
    .optional()
    .describe("annual interest rate, e.g. 0.05 (defaults to 0)"),
  monthlyPayment: z
    .union([z.number(), z.string()])
    .optional()
    .describe("monthly payment amount (defaults to 0)"),
  startMonth: z.number().int().optional().describe("month the liability begins (1-12, defaults to 1)"),
  termUnit: z.string().optional().describe("term unit, e.g. 'annual' (defaults to 'annual')"),
  balanceAsOfMonth: z.number().int().optional().describe("month the balance was last observed"),
  balanceAsOfYear: z.number().int().optional().describe("year the balance was last observed"),
  isInterestDeductible: z.boolean().optional().describe("whether interest is tax-deductible"),
  linkedPropertyId: z.string().optional().describe("real-estate account id this liability is secured against"),
  parentAccountId: z
    .string()
    .optional()
    .describe("business-account id; makes this a child-of-business liability (ownership inherited, no separate owners)"),
  ownerEntityId: z.string().optional().describe("owning entity id (legacy owner synthesis)"),
  owners: z
    .array(
      z.object({
        kind: z.enum(["family_member", "entity"]),
        familyMemberId: z.string().optional(),
        entityId: z.string().optional(),
        percent: z.number(),
      }),
    )
    .optional()
    .describe(
      "ownership split; percents are fractions summing to 1.0; mutually exclusive with parentAccountId",
    ),
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

  const addIncome = tool(
    async (input) => {
      try {
        const gate = await gateAccess(ctx.clientId);
        if ("error" in gate) return gate.error;

        const r = await createIncomeForClient({
          clientId: ctx.clientId,
          firmId: gate.firmId,
          actorId: ctx.userId,
          input,
        });
        if (!r.ok) return r.error;

        await recordAudit({
          action: "copilot.write_approved",
          resourceType: "income",
          resourceId: r.resourceId,
          clientId: ctx.clientId,
          firmId: gate.firmId,
          actorId: ctx.userId,
          metadata: { tool: "add_income", name: r.data.name },
        });

        return `Added income "${r.data.name}" (id ${r.resourceId}).`;
      } catch {
        return "Sorry — that action couldn't be completed.";
      }
    },
    {
      name: "add_income",
      description:
        "Add a new income to the current client's base-case plan. The model supplies the " +
        "income fields (type + name required); clientId is server-derived. " +
        APPROVAL_SUFFIX,
      schema: z.object({
        type: z.string().min(1).describe("income category, e.g. 'salary' or 'social_security'"),
        name: z.string().min(1).describe("display name for the income"),
        ...incomeFields,
      }),
    },
  );

  const updateIncome = tool(
    async ({ incomeId, ...input }) => {
      try {
        const gate = await gateAccess(ctx.clientId);
        if ("error" in gate) return gate.error;

        const r = await updateIncomeForClient({
          clientId: ctx.clientId,
          firmId: gate.firmId,
          actorId: ctx.userId,
          incomeId,
          input,
        });
        if (!r.ok) return r.error;

        await recordAudit({
          action: "copilot.write_approved",
          resourceType: "income",
          resourceId: r.resourceId,
          clientId: ctx.clientId,
          firmId: gate.firmId,
          actorId: ctx.userId,
          metadata: { tool: "update_income", name: r.data.name },
        });

        return `Updated income "${r.data.name}" (id ${r.resourceId}).`;
      } catch {
        return "Sorry — that action couldn't be completed.";
      }
    },
    {
      name: "update_income",
      description:
        "Update fields on an existing income in the current client's base-case plan. Pass the " +
        "incomeId plus only the fields to change. " +
        APPROVAL_SUFFIX,
      schema: z.object({
        incomeId: z.string().describe("id of the income to update"),
        type: z.string().min(1).optional().describe("income category, e.g. 'salary' or 'social_security'"),
        name: z.string().min(1).optional().describe("display name for the income"),
        ...incomeFields,
      }),
    },
  );

  const removeIncome = tool(
    async ({ incomeId }) => {
      try {
        const gate = await gateAccess(ctx.clientId);
        if ("error" in gate) return gate.error;

        const r = await deleteIncomeForClient({
          clientId: ctx.clientId,
          firmId: gate.firmId,
          actorId: ctx.userId,
          incomeId,
        });
        if (!r.ok) return r.error;

        await recordAudit({
          action: "copilot.write_approved",
          resourceType: "income",
          resourceId: r.resourceId,
          clientId: ctx.clientId,
          firmId: gate.firmId,
          actorId: ctx.userId,
          metadata: { tool: "remove_income" },
        });

        return `Removed income (id ${r.resourceId}).`;
      } catch {
        return "Sorry — that action couldn't be completed.";
      }
    },
    {
      name: "remove_income",
      description:
        "Remove an income from the current client's base-case plan by id. " +
        APPROVAL_SUFFIX,
      schema: z.object({
        incomeId: z.string().describe("id of the income to remove"),
      }),
    },
  );

  const addLiability = tool(
    async (input) => {
      try {
        const gate = await gateAccess(ctx.clientId);
        if ("error" in gate) return gate.error;

        const r = await createLiabilityForClient({
          clientId: ctx.clientId,
          firmId: gate.firmId,
          actorId: ctx.userId,
          input,
        });
        if (!r.ok) return r.error;

        await recordAudit({
          action: "copilot.write_approved",
          resourceType: "liability",
          resourceId: r.resourceId,
          clientId: ctx.clientId,
          firmId: gate.firmId,
          actorId: ctx.userId,
          metadata: { tool: "add_liability", name: r.data.name },
        });

        return `Added liability "${r.data.name}" (id ${r.resourceId}).`;
      } catch {
        return "Sorry — that action couldn't be completed.";
      }
    },
    {
      name: "add_liability",
      description:
        "Add a new liability to the current client's base-case plan. The model supplies the " +
        "liability fields (name + startYear + termMonths required); clientId is server-derived. " +
        APPROVAL_SUFFIX,
      schema: z.object({
        name: z.string().min(1).describe("display name for the liability"),
        ...liabilityFields,
      }),
    },
  );

  const updateLiability = tool(
    async ({ liabilityId, ...input }) => {
      try {
        const gate = await gateAccess(ctx.clientId);
        if ("error" in gate) return gate.error;

        const r = await updateLiabilityForClient({
          clientId: ctx.clientId,
          firmId: gate.firmId,
          actorId: ctx.userId,
          liabilityId,
          input,
        });
        if (!r.ok) return r.error;

        await recordAudit({
          action: "copilot.write_approved",
          resourceType: "liability",
          resourceId: r.resourceId,
          clientId: ctx.clientId,
          firmId: gate.firmId,
          actorId: ctx.userId,
          metadata: { tool: "update_liability", name: r.data.name },
        });

        return `Updated liability "${r.data.name}" (id ${r.resourceId}).`;
      } catch {
        return "Sorry — that action couldn't be completed.";
      }
    },
    {
      name: "update_liability",
      description:
        "Update fields on an existing liability in the current client's base-case plan. Pass the " +
        "liabilityId plus only the fields to change. " +
        APPROVAL_SUFFIX,
      schema: z.object({
        liabilityId: z.string().describe("id of the liability to update"),
        name: z.string().min(1).optional().describe("display name for the liability"),
        ...liabilityFields,
      }),
    },
  );

  const removeLiability = tool(
    async ({ liabilityId }) => {
      try {
        const gate = await gateAccess(ctx.clientId);
        if ("error" in gate) return gate.error;

        const r = await deleteLiabilityForClient({
          clientId: ctx.clientId,
          firmId: gate.firmId,
          actorId: ctx.userId,
          liabilityId,
        });
        if (!r.ok) return r.error;

        await recordAudit({
          action: "copilot.write_approved",
          resourceType: "liability",
          resourceId: r.resourceId,
          clientId: ctx.clientId,
          firmId: gate.firmId,
          actorId: ctx.userId,
          metadata: { tool: "remove_liability" },
        });

        return `Removed liability (id ${r.resourceId}).`;
      } catch {
        return "Sorry — that action couldn't be completed.";
      }
    },
    {
      name: "remove_liability",
      description:
        "Remove a liability from the current client's base-case plan by id. " +
        APPROVAL_SUFFIX,
      schema: z.object({
        liabilityId: z.string().describe("id of the liability to remove"),
      }),
    },
  );

  return [
    addExpense,
    updateExpense,
    removeExpense,
    addIncome,
    updateIncome,
    removeIncome,
    addLiability,
    updateLiability,
    removeLiability,
  ];
}
