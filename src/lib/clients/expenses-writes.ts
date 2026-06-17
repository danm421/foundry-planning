// Expense write-core. The single validation + write path shared by the API
// routes (src/app/api/clients/[id]/expenses/**) and the Copilot write tools, so
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
import { writeError, type EntityWriteResult } from "./entity-write-result";

type ExpenseRow = typeof expenses.$inferSelect;
// `type` is validated as a plain string by the schema (mirroring the route, which
// passed the raw body value), but the column is the expenseTypeEnum. Cast at the
// boundary so a bad value still fails at the DB exactly as it did via the route.
type ExpenseType = ExpenseRow["type"];

export async function createExpenseForClient(args: {
  clientId: string;
  firmId: string;
  actorId: string;
  input: unknown;
}): Promise<EntityWriteResult<ExpenseRow>> {
  const { clientId, firmId, actorId, input } = args;

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

  const [expense] = await db
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
      deductionType: (p.deductionType ?? null) as ExpenseRow["deductionType"],
      endsAtMedicareEligibilityOwner: p.endsAtMedicareEligibilityOwner ?? null,
    })
    .returning();

  await recordAudit({
    action: "expense.create",
    resourceType: "expense",
    resourceId: expense.id,
    clientId,
    firmId,
    actorId,
    metadata: { type: expense.type, name: expense.name },
  });

  return { ok: true, data: expense, resourceId: expense.id };
}

export async function updateExpenseForClient(args: {
  clientId: string;
  firmId: string;
  actorId: string;
  expenseId: string;
  input: unknown;
}): Promise<EntityWriteResult<ExpenseRow>> {
  const { clientId, firmId, actorId, expenseId, input } = args;

  const a = await verifyClientAccess(clientId);
  if (!a.ok || a.firmId !== firmId) {
    return writeError(404, "Client not found");
  }

  const parsed = expenseUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return writeError(400, formatZodIssues(parsed.error).map((i) => i.message).join("; "));
  }
  const p = parsed.data;

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

  const [updated] = await db
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
      ...(p.deductionType !== undefined && {
        deductionType: (p.deductionType ?? null) as ExpenseRow["deductionType"],
      }),
      ...(p.endsAtMedicareEligibilityOwner !== undefined && {
        endsAtMedicareEligibilityOwner: p.endsAtMedicareEligibilityOwner ?? null,
      }),
      updatedAt: new Date(),
    })
    .where(and(eq(expenses.id, expenseId), eq(expenses.clientId, clientId)))
    .returning();

  if (!updated) return writeError(404, "Expense not found");

  await recordAudit({
    action: "expense.update",
    resourceType: "expense",
    resourceId: expenseId,
    clientId,
    firmId,
    actorId,
    metadata: { type: updated.type, name: updated.name },
  });

  return { ok: true, data: updated, resourceId: expenseId };
}

export async function deleteExpenseForClient(args: {
  clientId: string;
  firmId: string;
  actorId: string;
  expenseId: string;
}): Promise<EntityWriteResult<{ id: string }>> {
  const { clientId, firmId, actorId, expenseId } = args;

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
  });

  return { ok: true, data: { id: expenseId }, resourceId: expenseId };
}
