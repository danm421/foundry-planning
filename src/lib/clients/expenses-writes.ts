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
import { expenses } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { verifyClientAccess } from "@/lib/clients/authz";
import {
  assertAccountsInClient,
  assertBusinessAccountsInClient,
  assertEntitiesInClient,
} from "@/lib/db-scoping";
import { recordAudit } from "@/lib/audit";
import { pruneOrphanScenarioChanges } from "@/lib/scenario/prune-changes";
import { formatZodIssues } from "@/lib/schemas/common";
import { expenseCreateSchema, expenseUpdateSchema } from "@/lib/schemas/expenses";
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

export async function createExpenseForClient(args: {
  clientId: string;
  firmId: string;
  actorId: string;
  input: unknown;
  crossFirmMeta?: Record<string, unknown>;
}): Promise<EntityWriteResult<ExpenseRow>> {
  const { clientId, firmId, actorId, input, crossFirmMeta } = args;

  const scenarioId = await baseCaseScenarioId(clientId, firmId);
  if (!scenarioId) return writeError(404, "Client not found");

  const parsed = expenseCreateSchema.safeParse(input);
  if (!parsed.success) {
    return writeError(400, formatZodIssues(parsed.error).map((i) => i.message).join("; "));
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
}): Promise<EntityWriteResult<ExpenseRow>> {
  const { clientId, firmId, actorId, expenseId, input, crossFirmMeta } = args;

  const a = await verifyClientAccess(clientId);
  if (!a.ok || a.firmId !== firmId) {
    return writeError(404, "Client not found");
  }

  const parsed = expenseUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return writeError(400, formatZodIssues(parsed.error).map((i) => i.message).join("; "));
  }
  const p = parsed.data;

  // Protect the seeded current/retirement living-expense rows — their type is
  // fixed at "living" so the plan always carries pre- and post-retirement
  // spending. Other field edits (amount, growth, years) stay allowed.
  if (p.type !== undefined) {
    const [target] = await db
      .select({ isDefault: expenses.isDefault, type: expenses.type })
      .from(expenses)
      .where(and(eq(expenses.id, expenseId), eq(expenses.clientId, clientId)));
    if (target?.isDefault && p.type !== target.type) {
      return writeError(400, "Default living-expense rows cannot change type.");
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
}): Promise<EntityWriteResult<{ id: string }>> {
  const { clientId, firmId, actorId, expenseId, crossFirmMeta } = args;

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
    metadata: crossFirmMeta,
  });

  return { ok: true, data: { id: expenseId }, resourceId: expenseId };
}
