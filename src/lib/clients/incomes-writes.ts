// Income write-core. The single validation + write path shared by the API
// routes (src/app/api/clients/[id]/incomes/**) and the Copilot write tools, so
// route and agent can never drift. Cloned from expenses-writes.ts — the shared
// baseCaseScenarioId helper (./base-case), same FK-assert sequence, same
// orphan-prune, same metadata-only audit; income-specific deltas noted inline.
//
// Lifted verbatim from the route bodies: base-case scenario lookup, zod parse,
// the same three FK asserts (entities / accounts / business accounts), the single
// insert/update/delete, orphan-change prune, and the metadata-only
// income.{create,update,delete} audit. The only deltas vs the route:
// firmId/actorId are passed in (the route reads them from Clerk via
// requireOrgId()/auth()), and NextResponse.json(...) becomes writeError(...) /
// {ok:true,...}.
//
// Income-specific notes:
//   • No isDefault guard on delete (incomes have no such column).
//   • taxType is create-only: the live PUT route does NOT include taxType in
//     its .set() — the update core honours this by omitting taxType from the
//     conditional-set, even though incomeUpdateSchema technically accepts it.
//   • SS fields (owner, claimingAge, claimingAgeMonths, claimingAgeMode,
//     ssBenefitMode, piaMonthly) are included in both create and update where
//     the route includes them.
import { db } from "@/db";
import { incomes } from "@/db/schema";
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
import { incomeCreateSchema, incomeUpdateSchema } from "@/lib/schemas/incomes";
import { baseCaseScenarioId } from "./base-case";
import { writeError, type EntityWriteResult } from "./entity-write-result";

type IncomeRow = typeof incomes.$inferSelect;

export async function createIncomeForClient(args: {
  clientId: string;
  firmId: string;
  actorId: string;
  input: unknown;
  crossFirmMeta?: Record<string, unknown>;
}): Promise<EntityWriteResult<IncomeRow>> {
  const { clientId, firmId, actorId, input, crossFirmMeta } = args;

  const scenarioId = await baseCaseScenarioId(clientId, firmId);
  if (!scenarioId) return writeError(404, "Client not found");

  const parsed = incomeCreateSchema.safeParse(input);
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

  // INSERT column list lifted verbatim from POST route (route.ts L122–148).
  const [income] = await db
    .insert(incomes)
    .values({
      clientId,
      scenarioId,
      type: p.type as IncomeRow["type"],
      name: p.name,
      annualAmount: p.annualAmount ?? "0",
      startYear: p.startYear,
      endYear: p.endYear,
      growthRate: p.growthRate ?? "0.03",
      growthSource: p.growthSource === "inflation" ? "inflation" : "custom",
      owner: (p.owner ?? "client") as IncomeRow["owner"],
      claimingAge: p.claimingAge ?? null,
      ownerEntityId: p.ownerEntityId ?? null,
      ownerAccountId: p.ownerAccountId ?? null,
      cashAccountId: p.cashAccountId ?? null,
      inflationStartYear: p.inflationStartYear != null ? p.inflationStartYear : null,
      startYearRef: (p.startYearRef ?? null) as IncomeRow["startYearRef"],
      endYearRef: (p.endYearRef ?? null) as IncomeRow["endYearRef"],
      taxType: (p.taxType ?? null) as IncomeRow["taxType"],
      ssBenefitMode: (p.ssBenefitMode ?? null) as IncomeRow["ssBenefitMode"],
      piaMonthly: p.piaMonthly ?? null,
      claimingAgeMonths: p.claimingAgeMonths ?? 0,
      claimingAgeMode: (p.claimingAgeMode ?? null) as IncomeRow["claimingAgeMode"],
    })
    .returning();

  await recordAudit({
    action: "income.create",
    resourceType: "income",
    resourceId: income.id,
    clientId,
    firmId,
    actorId,
    metadata: { type: income.type, name: income.name, ...(crossFirmMeta ?? {}) },
  });

  return { ok: true, data: income, resourceId: income.id };
}

export async function updateIncomeForClient(args: {
  clientId: string;
  firmId: string;
  actorId: string;
  incomeId: string;
  input: unknown;
  crossFirmMeta?: Record<string, unknown>;
}): Promise<EntityWriteResult<IncomeRow>> {
  const { clientId, firmId, actorId, incomeId, input, crossFirmMeta } = args;

  const a = await verifyClientAccess(clientId);
  if (!a.ok || a.firmId !== firmId) {
    return writeError(404, "Client not found");
  }

  const parsed = incomeUpdateSchema.safeParse(input);
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

  // UPDATE .set() column list lifted verbatim from PUT route ([incomeId]/route.ts L81–103).
  // NOTE: taxType is intentionally absent — the live PUT route does not include it,
  // so we honour that here even though incomeUpdateSchema accepts taxType.
  const [updated] = await db
    .update(incomes)
    .set({
      ...(p.type !== undefined && { type: p.type as IncomeRow["type"] }),
      ...(p.name !== undefined && { name: p.name }),
      ...(p.annualAmount !== undefined && { annualAmount: p.annualAmount }),
      ...(p.startYear !== undefined && { startYear: p.startYear }),
      ...(p.endYear !== undefined && { endYear: p.endYear }),
      ...(p.growthRate !== undefined && { growthRate: p.growthRate }),
      ...(p.growthSource !== undefined && {
        growthSource: p.growthSource === "inflation" ? "inflation" : "custom",
      }),
      ...(p.owner !== undefined && { owner: p.owner as IncomeRow["owner"] }),
      ...(p.claimingAge !== undefined && { claimingAge: p.claimingAge ?? null }),
      ...(p.ownerEntityId !== undefined && { ownerEntityId: p.ownerEntityId ?? null }),
      ...(p.ownerAccountId !== undefined && { ownerAccountId: p.ownerAccountId ?? null }),
      ...(p.cashAccountId !== undefined && { cashAccountId: p.cashAccountId ?? null }),
      ...(p.inflationStartYear !== undefined && {
        inflationStartYear: p.inflationStartYear == null ? null : p.inflationStartYear,
      }),
      ...(p.startYearRef !== undefined && {
        startYearRef: (p.startYearRef ?? null) as IncomeRow["startYearRef"],
      }),
      ...(p.endYearRef !== undefined && {
        endYearRef: (p.endYearRef ?? null) as IncomeRow["endYearRef"],
      }),
      ...(p.ssBenefitMode !== undefined && {
        ssBenefitMode: (p.ssBenefitMode ?? null) as IncomeRow["ssBenefitMode"],
      }),
      ...(p.piaMonthly !== undefined && { piaMonthly: p.piaMonthly ?? null }),
      ...(p.claimingAgeMonths !== undefined && { claimingAgeMonths: p.claimingAgeMonths ?? 0 }),
      ...(p.claimingAgeMode !== undefined && {
        claimingAgeMode: (p.claimingAgeMode ?? null) as IncomeRow["claimingAgeMode"],
      }),
      updatedAt: new Date(),
    })
    .where(and(eq(incomes.id, incomeId), eq(incomes.clientId, clientId)))
    .returning();

  if (!updated) return writeError(404, "Income not found");

  await recordAudit({
    action: "income.update",
    resourceType: "income",
    resourceId: incomeId,
    clientId,
    firmId,
    actorId,
    metadata: { type: updated.type, name: updated.name, ...(crossFirmMeta ?? {}) },
  });

  return { ok: true, data: updated, resourceId: incomeId };
}

export async function deleteIncomeForClient(args: {
  clientId: string;
  firmId: string;
  actorId: string;
  incomeId: string;
  crossFirmMeta?: Record<string, unknown>;
}): Promise<EntityWriteResult<{ id: string }>> {
  const { clientId, firmId, actorId, incomeId, crossFirmMeta } = args;

  const a = await verifyClientAccess(clientId);
  if (!a.ok || a.firmId !== firmId) {
    return writeError(404, "Client not found");
  }

  // No isDefault guard — incomes have no default rows unlike expenses.
  await db.transaction(async (tx) => {
    await tx
      .delete(incomes)
      .where(and(eq(incomes.id, incomeId), eq(incomes.clientId, clientId)));
    await pruneOrphanScenarioChanges(tx, incomeId);
  });

  await recordAudit({
    action: "income.delete",
    resourceType: "income",
    resourceId: incomeId,
    clientId,
    firmId,
    actorId,
    metadata: crossFirmMeta,
  });

  return { ok: true, data: { id: incomeId }, resourceId: incomeId };
}
