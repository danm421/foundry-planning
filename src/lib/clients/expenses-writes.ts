// Expense write-core. The single validation + write path shared by the API
// routes (src/app/api/clients/[id]/expenses/**) and the Forge write tools, so
// route and agent can never drift. This is the TEMPLATE the income / liability /
// account cores copy — keep the shape uniform. The base-case scenario lookup is
// the one piece factored out of all four into the shared ./base-case helper.
//
// Lifted verbatim from the route bodies: base-case scenario lookup, zod parse,
// the same three FK asserts (entities / accounts / business accounts), the single
// insert/update/delete, the isDefault delete guard, orphan-change prune, and the
// metadata-only expense.{create,update,delete} audit. The only deltas vs the
// route: firmId/actorId are passed in (the route reads them from Clerk via
// requireOrgId()/auth()), and NextResponse.json(...) becomes writeError(...) /
// {ok:true,...}.
import { db } from "@/db";
import { expenses, planSettings } from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { verifyClientAccess } from "@/lib/clients/authz";
import {
  assertAccountsInClient,
  assertBusinessAccountsInClient,
  assertEntitiesInClient,
} from "@/lib/db-scoping";
import { recordAudit } from "@/lib/audit";
import { pruneOrphanScenarioChanges } from "@/lib/scenario/prune-changes";
import { summarizeZodIssues } from "@/lib/schemas/common";
import { expenseCreateSchema, expenseUpdateSchema } from "@/lib/schemas/expenses";
import { isRetirementLivingExpense } from "@/lib/solver/living-expense";
import { baseCaseScenarioId } from "./base-case";
import { replaceDedicatedAccounts } from "./dedicated-accounts";
import { writeError, type EntityWriteResult } from "./entity-write-result";

type ExpenseRow = typeof expenses.$inferSelect;
// `type` is validated as a plain string by the schema (mirroring the route, which
// passed the raw body value), but the column is the expenseTypeEnum. Cast at the
// boundary so a bad value still fails at the DB exactly as it did via the route.
type ExpenseType = ExpenseRow["type"];

// Dedupe dedicatedAccountIds before the FK guard and the insert: duplicate ids
// pass assertAccountsInClient fine but violate the unique(expenseId, accountId)
// constraint on expense_dedicated_accounts, surfacing a raw 500 instead of
// being handled. Array order = sortOrder = draw order, so preserve
// first-occurrence order.
function dedupeDedicatedIds(ids: string[] | undefined): string[] | undefined {
  return ids && [...new Set(ids)];
}

// Both write paths enforce the same two rules for `absorbsRemainingCashFlow`,
// and Task 6's dialog surfaces these strings verbatim — so they live here once
// rather than as two copies that can drift apart.
const ABSORB_NON_LIVING_ERROR =
  "Only living expenses can spend the remaining cash flow.";
// Retirement living rows are excluded on purpose. The solver's
// `living-expense-scale` / `living-expense-amount` lever targets exactly those
// rows and has no absorb guard of its own: on a row that already spends every
// leftover dollar, scaling `annualAmount` moves only the FLOOR, so the server's
// bisect search is flat across most of its range and the retirement solve comes
// back "unreachable" or simply wrong. Absorption is a working-years lifestyle
// assumption (see surplus-spend.ts), so the current row is the only one that
// may carry it.
const ABSORB_RETIREMENT_ERROR =
  "Only the current living expenses row can spend the remaining cash flow.";

/** The base case's plan start year for a (client, scenario), or null when the
 *  scenario has no settings row. Only read on the absorb path, so the ordinary
 *  expense write still costs exactly the queries it did before. */
async function planStartYearFor(
  clientId: string,
  scenarioId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ y: planSettings.planStartYear })
    .from(planSettings)
    .where(
      and(eq(planSettings.clientId, clientId), eq(planSettings.scenarioId, scenarioId)),
    );
  return row?.y ?? null;
}

/**
 * The at-most-one-absorbing-row-per-(client, scenario) rule. Pass
 * `excludeExpenseId` on update: without it, re-saving the absorbing row would
 * find itself and block the save forever.
 */
async function absorbingRowConflict(
  clientId: string,
  scenarioId: string,
  excludeExpenseId?: string,
): Promise<{ ok: false; status: number; error: string } | null> {
  const [other] = await db
    .select({ name: expenses.name })
    .from(expenses)
    .where(
      and(
        eq(expenses.clientId, clientId),
        eq(expenses.scenarioId, scenarioId),
        eq(expenses.absorbsRemainingCashFlow, true),
        ...(excludeExpenseId ? [ne(expenses.id, excludeExpenseId)] : []),
      ),
    );
  return other
    ? writeError(
        400,
        `Another living expense ("${other.name}") already spends the remaining cash flow.`,
      )
    : null;
}

export async function createExpenseForClient(args: {
  clientId: string;
  firmId: string;
  actorId: string;
  input: unknown;
  crossFirmMeta?: Record<string, unknown>;
  // 'client' for portal edits; omitted (→ recordAudit's own 'advisor' default)
  // for every advisor call site. Never change that default from here.
  actorKind?: "advisor" | "client" | "system";
}): Promise<EntityWriteResult<ExpenseRow>> {
  const { clientId, firmId, actorId, input, crossFirmMeta, actorKind } = args;

  const scenarioId = await baseCaseScenarioId(clientId, firmId);
  if (!scenarioId) return writeError(404, "Client not found");

  const parsed = expenseCreateSchema.safeParse(input);
  if (!parsed.success) {
    return writeError(400, summarizeZodIssues(parsed.error));
  }
  const p = parsed.data;

  const entCheck = await assertEntitiesInClient(clientId, [p.ownerEntityId]);
  if (!entCheck.ok) return writeError(400, entCheck.reason);
  const acctCheck = await assertAccountsInClient(clientId, [p.cashAccountId, p.ownerAccountId]);
  if (!acctCheck.ok) return writeError(400, acctCheck.reason);
  if (p.ownerAccountId != null) {
    const bizCheck = await assertBusinessAccountsInClient(clientId, [p.ownerAccountId]);
    if (!bizCheck.ok) return writeError(400, bizCheck.reason);
  }
  const dedicatedAccountIds = dedupeDedicatedIds(p.dedicatedAccountIds);
  if (dedicatedAccountIds && dedicatedAccountIds.length > 0) {
    const dedCheck = await assertAccountsInClient(clientId, dedicatedAccountIds);
    if (!dedCheck.ok) return writeError(400, dedCheck.reason);
  }

  // The flag only means anything on a living row; the engine's own filter
  // ignores it elsewhere, but a stored-but-inert flag is a lie the UI renders.
  if (p.absorbsRemainingCashFlow) {
    if (p.type !== "living") return writeError(400, ABSORB_NON_LIVING_ERROR);
    const planStart = await planStartYearFor(clientId, scenarioId);
    if (
      planStart != null &&
      isRetirementLivingExpense(
        {
          type: p.type,
          startYear: p.startYear,
          endYear: p.endYear,
          startYearRef: (p.startYearRef ?? null) as string | null,
        },
        planStart,
      )
    ) {
      return writeError(400, ABSORB_RETIREMENT_ERROR);
    }
    const conflict = await absorbingRowConflict(clientId, scenarioId);
    if (conflict) return conflict;
  }

  const expense = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(expenses)
      .values({
        clientId,
        scenarioId,
        type: p.type as ExpenseType,
        name: p.name,
        annualAmount: p.annualAmount,
        startYear: p.startYear,
        endYear: p.endYear,
        growthRate: p.growthRate,
        growthSource: p.growthSource,
        paymentMonth: p.paymentMonth ?? null,
        ownerEntityId: p.ownerEntityId ?? null,
        ownerAccountId: p.ownerAccountId ?? null,
        cashAccountId: p.cashAccountId ?? null,
        inflationStartYear: p.inflationStartYear ?? null,
        startYearRef: (p.startYearRef ?? null) as ExpenseRow["startYearRef"],
        endYearRef: (p.endYearRef ?? null) as ExpenseRow["endYearRef"],
        // Living expenses are never a deduction — drop any deductionType so the
        // UI (which hides the field for living) and the write-core stay in sync.
        deductionType: (p.type === "living"
          ? null
          : (p.deductionType ?? null)) as ExpenseRow["deductionType"],
        endsAtMedicareEligibilityOwner: p.endsAtMedicareEligibilityOwner ?? null,
        payShortfallOutOfPocket: p.payShortfallOutOfPocket ?? false,
        institutionState: p.institutionState ?? null,
        institutionName: p.institutionName ?? null,
        forFamilyMemberId: p.forFamilyMemberId ?? null,
        isGoal: p.isGoal ?? false,
        absorbsRemainingCashFlow: p.absorbsRemainingCashFlow ?? false,
      })
      .returning();
    if (dedicatedAccountIds && dedicatedAccountIds.length > 0) {
      await replaceDedicatedAccounts(tx, row.id, dedicatedAccountIds);
    }
    return row;
  });

  await recordAudit({
    action: "expense.create",
    resourceType: "expense",
    resourceId: expense.id,
    clientId,
    firmId,
    actorId,
    actorKind,
    metadata: { type: expense.type, name: expense.name, ...(crossFirmMeta ?? {}) },
  });

  return { ok: true, data: expense, resourceId: expense.id };
}

export async function updateExpenseForClient(args: {
  clientId: string;
  firmId: string;
  actorId: string;
  expenseId: string;
  input: unknown;
  crossFirmMeta?: Record<string, unknown>;
  actorKind?: "advisor" | "client" | "system";
}): Promise<EntityWriteResult<ExpenseRow>> {
  const { clientId, firmId, actorId, expenseId, input, crossFirmMeta, actorKind } = args;

  const a = await verifyClientAccess(clientId);
  if (!a.ok || a.firmId !== firmId) {
    return writeError(404, "Client not found");
  }

  const parsed = expenseUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return writeError(400, summarizeZodIssues(parsed.error));
  }
  const p = parsed.data;

  // Protect the seeded current/retirement living-expense rows — their type is
  // fixed at "living" so the plan always carries pre- and post-retirement
  // spending. Other field edits (amount, growth, years) stay allowed.
  //
  // Effective type after this update: an omitted `type` keeps the stored one.
  // Needed by BOTH the isDefault type guard below and the absorb guards, so one
  // query serves all three.
  let target:
    | {
        isDefault: boolean;
        type: ExpenseType;
        scenarioId: string;
        startYear: number;
        endYear: number;
        startYearRef: ExpenseRow["startYearRef"];
      }
    | undefined;
  if (p.type !== undefined || p.absorbsRemainingCashFlow !== undefined) {
    [target] = await db
      .select({
        isDefault: expenses.isDefault,
        type: expenses.type,
        scenarioId: expenses.scenarioId,
        // The absorb guard tests the row AFTER the patch lands, and a patch that
        // only flips the flag carries no years — so they come from the stored row.
        startYear: expenses.startYear,
        endYear: expenses.endYear,
        startYearRef: expenses.startYearRef,
      })
      .from(expenses)
      .where(and(eq(expenses.id, expenseId), eq(expenses.clientId, clientId)));
  }
  if (p.type !== undefined && target?.isDefault && p.type !== target.type) {
    return writeError(400, "Default living-expense rows cannot change type.");
  }
  if (p.absorbsRemainingCashFlow) {
    // An omitted `type` keeps the stored one.
    if ((p.type ?? target?.type) !== "living") {
      return writeError(400, ABSORB_NON_LIVING_ERROR);
    }
    if (target) {
      const planStart = await planStartYearFor(clientId, target.scenarioId);
      if (
        planStart != null &&
        isRetirementLivingExpense(
          {
            type: p.type ?? target.type,
            startYear: p.startYear ?? target.startYear,
            endYear: p.endYear ?? target.endYear,
            // `??` would treat an explicit null (the caller CLEARING the ref) as
            // "absent" and resurrect the stored anchor, so test for undefined.
            startYearRef: (p.startYearRef !== undefined
              ? p.startYearRef
              : target.startYearRef) as string | null,
          },
          planStart,
        )
      ) {
        return writeError(400, ABSORB_RETIREMENT_ERROR);
      }
      const conflict = await absorbingRowConflict(clientId, target.scenarioId, expenseId);
      if (conflict) return conflict;
    }
  }

  if (p.ownerEntityId !== undefined) {
    const c = await assertEntitiesInClient(clientId, [p.ownerEntityId]);
    if (!c.ok) return writeError(400, c.reason);
  }
  if (p.cashAccountId !== undefined || p.ownerAccountId !== undefined) {
    const c = await assertAccountsInClient(clientId, [
      p.cashAccountId !== undefined ? p.cashAccountId : null,
      p.ownerAccountId !== undefined ? p.ownerAccountId : null,
    ]);
    if (!c.ok) return writeError(400, c.reason);
  }
  if (p.ownerAccountId !== undefined && p.ownerAccountId != null) {
    const b = await assertBusinessAccountsInClient(clientId, [p.ownerAccountId]);
    if (!b.ok) return writeError(400, b.reason);
  }
  const dedicatedAccountIds = dedupeDedicatedIds(p.dedicatedAccountIds);
  if (dedicatedAccountIds !== undefined && dedicatedAccountIds.length > 0) {
    const dedCheck = await assertAccountsInClient(clientId, dedicatedAccountIds);
    if (!dedCheck.ok) return writeError(400, dedCheck.reason);
  }

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(expenses)
      .set({
        ...(p.type !== undefined && { type: p.type as ExpenseType }),
        ...(p.name !== undefined && { name: p.name }),
        ...(p.annualAmount !== undefined && { annualAmount: p.annualAmount }),
        ...(p.startYear !== undefined && { startYear: p.startYear }),
        ...(p.endYear !== undefined && { endYear: p.endYear }),
        ...(p.growthRate !== undefined && { growthRate: p.growthRate }),
        ...(p.growthSource !== undefined && { growthSource: p.growthSource }),
        ...(p.paymentMonth !== undefined && { paymentMonth: p.paymentMonth }),
        ...(p.ownerEntityId !== undefined && { ownerEntityId: p.ownerEntityId ?? null }),
        ...(p.ownerAccountId !== undefined && { ownerAccountId: p.ownerAccountId ?? null }),
        ...(p.cashAccountId !== undefined && { cashAccountId: p.cashAccountId ?? null }),
        ...(p.inflationStartYear !== undefined && {
          inflationStartYear: p.inflationStartYear == null ? null : p.inflationStartYear,
        }),
        ...(p.startYearRef !== undefined && {
          startYearRef: (p.startYearRef ?? null) as ExpenseRow["startYearRef"],
        }),
        ...(p.endYearRef !== undefined && {
          endYearRef: (p.endYearRef ?? null) as ExpenseRow["endYearRef"],
        }),
        // Living expenses are never a deduction. When the row is (re)typed to
        // living, force deductionType null even if the caller omitted it; otherwise
        // pass through the supplied value.
        ...((p.deductionType !== undefined || p.type === "living") && {
          deductionType: (p.type === "living"
            ? null
            : (p.deductionType ?? null)) as ExpenseRow["deductionType"],
        }),
        ...(p.endsAtMedicareEligibilityOwner !== undefined && {
          endsAtMedicareEligibilityOwner: p.endsAtMedicareEligibilityOwner ?? null,
        }),
        ...(p.payShortfallOutOfPocket !== undefined && {
          payShortfallOutOfPocket: p.payShortfallOutOfPocket,
        }),
        ...(p.institutionState !== undefined && { institutionState: p.institutionState ?? null }),
        ...(p.institutionName !== undefined && { institutionName: p.institutionName ?? null }),
        ...(p.forFamilyMemberId !== undefined && { forFamilyMemberId: p.forFamilyMemberId ?? null }),
        ...(p.isGoal !== undefined && { isGoal: p.isGoal }),
        ...(p.absorbsRemainingCashFlow !== undefined && {
          absorbsRemainingCashFlow: p.absorbsRemainingCashFlow,
        }),
        updatedAt: new Date(),
      })
      .where(and(eq(expenses.id, expenseId), eq(expenses.clientId, clientId)))
      .returning();

    if (!row) return undefined;

    if (dedicatedAccountIds !== undefined) {
      await replaceDedicatedAccounts(tx, expenseId, dedicatedAccountIds);
    }

    return row;
  });

  if (!updated) return writeError(404, "Expense not found");

  await recordAudit({
    action: "expense.update",
    resourceType: "expense",
    resourceId: expenseId,
    clientId,
    firmId,
    actorId,
    actorKind,
    metadata: { type: updated.type, name: updated.name, ...(crossFirmMeta ?? {}) },
  });

  return { ok: true, data: updated, resourceId: expenseId };
}

export async function deleteExpenseForClient(args: {
  clientId: string;
  firmId: string;
  actorId: string;
  expenseId: string;
  crossFirmMeta?: Record<string, unknown>;
  actorKind?: "advisor" | "client" | "system";
}): Promise<EntityWriteResult<{ id: string }>> {
  const { clientId, firmId, actorId, expenseId, crossFirmMeta, actorKind } = args;

  const a = await verifyClientAccess(clientId);
  if (!a.ok || a.firmId !== firmId) {
    return writeError(404, "Client not found");
  }

  // Protect the seeded current/retirement living-expense rows — every client needs them.
  const [target] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.clientId, clientId)));
  if (target?.isDefault) {
    return writeError(400, "Default living-expense rows cannot be deleted.");
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(expenses)
      .where(and(eq(expenses.id, expenseId), eq(expenses.clientId, clientId)));
    await pruneOrphanScenarioChanges(tx, expenseId);
  });

  await recordAudit({
    action: "expense.delete",
    resourceType: "expense",
    resourceId: expenseId,
    clientId,
    firmId,
    actorId,
    actorKind,
    metadata: crossFirmMeta,
  });

  return { ok: true, data: { id: expenseId }, resourceId: expenseId };
}
