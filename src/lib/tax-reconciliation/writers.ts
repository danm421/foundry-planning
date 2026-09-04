// Scoped writers for the plan tables that have no shared write core. Each
// mirrors its API route's gate + write + audit (plan-settings, clients,
// deductions, entities, medicare-coverage routes) so Plan vs. Return cannot
// drift from what the screens themselves do.
//
// The one exception is `claimSocialSecurityForReturn`, which writes a table
// that DOES have a core (`incomes-writes`). It exists because a split claim is
// TWO row writes that must land together — see its own note.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { accountOwners, accounts, clientDeductions, clients, entities, incomes, medicareCoverage, planSettings } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { requireActiveSubscriptionForFirm } from "@/lib/authz";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { baseCaseScenarioId } from "@/lib/clients/base-case";
import { writeError, type EntityWriteResult } from "@/lib/clients/entity-write-result";
import { summarizeZodIssues } from "@/lib/schemas/common";
import { isUSPSStateCode } from "@/lib/usps-states";

interface Common { clientId: string; firmId: string; actorId: string; crossFirmMeta: Record<string, unknown> }
type R = Promise<EntityWriteResult<{ id: string }>>;
type Denied = { ok: false; status: number; error: string };

/** Route-order gate: prove edit access, then prove the firm's subscription. */
async function gate(c: Common): Promise<Denied | null> {
  const { firmId } = await requireClientEditAccess(c.clientId);
  // The caller states the firm it is acting for. If that disagrees with the firm the
  // access check just resolved, the subscription check below would test the wrong firm
  // and the audit row would name it — so refuse, with the cores' own 404.
  if (firmId !== c.firmId) return writeError(404, "Client not found");
  await requireActiveSubscriptionForFirm(c.firmId);
  return null;
}

export async function updatePlanSettingsForReturn(a: Common & { patch: { residenceState?: string; capitalLossCarryforwardLt?: number } }): R {
  const denied = await gate(a);
  if (denied) return denied;
  if (a.patch.residenceState !== undefined && !isUSPSStateCode(a.patch.residenceState)) return writeError(400, "residenceState must be a USPS 2-letter code");
  if (a.patch.capitalLossCarryforwardLt !== undefined && !(a.patch.capitalLossCarryforwardLt >= 0)) return writeError(400, "capitalLossCarryforwardLt must be a non-negative number");
  const scenarioId = await baseCaseScenarioId(a.clientId, a.firmId);
  if (!scenarioId) return writeError(404, "Client not found");
  const [row] = await db.update(planSettings).set({
    ...(a.patch.residenceState !== undefined && { residenceState: a.patch.residenceState }),
    ...(a.patch.capitalLossCarryforwardLt !== undefined && { capitalLossCarryforwardLt: String(a.patch.capitalLossCarryforwardLt) }),
    updatedAt: new Date(),
  }).where(and(eq(planSettings.clientId, a.clientId), eq(planSettings.scenarioId, scenarioId))).returning({ id: planSettings.id });
  if (!row) return writeError(404, "No plan settings found");
  await recordAudit({ action: "plan_settings.update", resourceType: "plan_settings", resourceId: row.id, clientId: a.clientId, firmId: a.firmId, actorId: a.actorId, metadata: { ...a.crossFirmMeta, fields: Object.keys(a.patch), source: "plan_vs_return" } });
  return { ok: true, data: { id: row.id }, resourceId: row.id };
}

export async function updateClientFilingStatus(a: Common & { filingStatus: "single" | "married_joint" | "married_separate" | "head_of_household" }): R {
  const denied = await gate(a);
  if (denied) return denied;
  const [row] = await db.update(clients).set({ filingStatus: a.filingStatus, updatedAt: new Date() }).where(and(eq(clients.id, a.clientId), eq(clients.firmId, a.firmId))).returning({ id: clients.id });
  if (!row) return writeError(404, "Client not found");
  await recordAudit({ action: "client.update", resourceType: "client", resourceId: a.clientId, clientId: a.clientId, firmId: a.firmId, actorId: a.actorId, metadata: { ...a.crossFirmMeta, filingStatus: a.filingStatus, source: "plan_vs_return" } });
  return { ok: true, data: { id: a.clientId }, resourceId: a.clientId };
}

export async function createDeductionForReturn(a: Common & { input: { type: "charitable"; name: string; owner: "joint"; annualAmount: number; growthRate: number; startYear: number; endYear: number } }): R {
  const denied = await gate(a);
  if (denied) return denied;
  const scenarioId = await baseCaseScenarioId(a.clientId, a.firmId);
  if (!scenarioId) return writeError(404, "Client not found");
  const [row] = await db.insert(clientDeductions).values({ clientId: a.clientId, scenarioId, type: a.input.type, name: a.input.name, owner: a.input.owner, annualAmount: String(a.input.annualAmount), growthRate: String(a.input.growthRate), startYear: a.input.startYear, endYear: a.input.endYear }).returning({ id: clientDeductions.id });
  await recordAudit({ action: "deduction.create", resourceType: "deduction", resourceId: row.id, clientId: a.clientId, firmId: a.firmId, actorId: a.actorId, metadata: { ...a.crossFirmMeta, type: a.input.type, name: a.input.name, source: "plan_vs_return" } });
  return { ok: true, data: { id: row.id }, resourceId: row.id };
}

export async function updateDeductionAmount(a: Common & { deductionId: string; annualAmount: number }): R {
  const denied = await gate(a);
  if (denied) return denied;
  const [row] = await db.update(clientDeductions).set({ annualAmount: String(a.annualAmount), updatedAt: new Date() }).where(and(eq(clientDeductions.id, a.deductionId), eq(clientDeductions.clientId, a.clientId))).returning({ id: clientDeductions.id });
  if (!row) return writeError(404, "Deduction not found");
  await recordAudit({ action: "deduction.update", resourceType: "deduction", resourceId: row.id, clientId: a.clientId, firmId: a.firmId, actorId: a.actorId, metadata: { ...a.crossFirmMeta, source: "plan_vs_return" } });
  return { ok: true, data: { id: row.id }, resourceId: row.id };
}

export async function createEntityForReturn(a: Common & { input: { name: string; entityType: "s_corp" | "partnership"; taxTreatment: "qbi" | "ordinary"; value: number } }): R {
  const denied = await gate(a);
  if (denied) return denied;
  const scenarioId = await baseCaseScenarioId(a.clientId, a.firmId);
  if (!scenarioId) return writeError(404, "Client not found");
  const entity = await db.transaction(async (tx) => {
    const [e] = await tx.insert(entities).values({ clientId: a.clientId, name: a.input.name, entityType: a.input.entityType, taxTreatment: a.input.taxTreatment, value: String(a.input.value), basis: "0" }).returning({ id: entities.id, name: entities.name });
    // Same default cash bucket POST /entities creates, so the engine can route the entity's flows.
    const [acct] = await tx.insert(accounts).values({ clientId: a.clientId, scenarioId, name: `${e.name} — Cash`, category: "cash", subType: "checking", value: "0", basis: "0", growthRate: null, rmdEnabled: false, isDefaultChecking: true }).returning({ id: accounts.id });
    await tx.insert(accountOwners).values({ accountId: acct.id, entityId: e.id, familyMemberId: null, percent: "1.0000" });
    return e;
  });
  await recordAudit({ action: "entity.create", resourceType: "entity", resourceId: entity.id, clientId: a.clientId, firmId: a.firmId, actorId: a.actorId, metadata: { ...a.crossFirmMeta, name: entity.name, entityType: a.input.entityType, source: "plan_vs_return" } });
  return { ok: true, data: { id: entity.id }, resourceId: entity.id };
}

export async function updateEntityTaxTreatment(a: Common & { entityId: string; taxTreatment: "qbi" }): R {
  const denied = await gate(a);
  if (denied) return denied;
  const [row] = await db.update(entities).set({ taxTreatment: a.taxTreatment, updatedAt: new Date() }).where(and(eq(entities.id, a.entityId), eq(entities.clientId, a.clientId))).returning({ id: entities.id });
  if (!row) return writeError(404, "Entity not found");
  await recordAudit({ action: "entity.update", resourceType: "entity", resourceId: row.id, clientId: a.clientId, firmId: a.firmId, actorId: a.actorId, metadata: { ...a.crossFirmMeta, taxTreatment: a.taxTreatment, source: "plan_vs_return" } });
  return { ok: true, data: { id: row.id }, resourceId: row.id };
}

export async function upsertMedicarePriorYearMagi(a: Common & { owner: "client" | "spouse"; priorYearMagi: number }): R {
  const denied = await gate(a);
  if (denied) return denied;
  await db.insert(medicareCoverage).values({ clientId: a.clientId, owner: a.owner, priorYearMagi: String(a.priorYearMagi), estimatePriorYearMagiFromProjection: false })
    .onConflictDoUpdate({ target: [medicareCoverage.clientId, medicareCoverage.owner], set: { priorYearMagi: String(a.priorYearMagi), estimatePriorYearMagiFromProjection: false, updatedAt: new Date() } });
  const id = `${a.clientId}:${a.owner}`;
  await recordAudit({ action: "medicare_coverage.upsert", resourceType: "medicare_coverage", resourceId: id, clientId: a.clientId, firmId: a.firmId, actorId: a.actorId, metadata: { ...a.crossFirmMeta, owner: a.owner, source: "plan_vs_return" } });
  return { ok: true, data: { id }, resourceId: id };
}

/** Exactly the columns `rules/social-security.ts` puts in a claim row's patch, plus the
 *  amount `apply.ts` resolves. `.strict()` on purpose: this writer knows how to write
 *  these six columns and nothing else, so a rule that starts emitting a seventh has to
 *  fail loudly here rather than have it silently dropped on the floor. */
const ssClaimPatchSchema = z.object({
  ssBenefitMode: z.literal("manual_amount"),
  claimingAgeMode: z.literal("years"),
  claimingAge: z.number().int(),
  startYear: z.number().int(),
  inflationStartYear: z.number().int(),
  annualAmount: z.number().finite(),
}).strict();

class IncomeRowMissingError extends Error {}

/**
 * Record an already-started Social Security benefit on one row, or split it across two.
 *
 * This is the one writer here whose table has a shared core (`updateIncomeForClient`).
 * It exists because a SPLIT is two row writes and the core cannot join a caller's
 * transaction — it holds its own `db` handle — so calling it twice would let a failure on
 * the second write leave one spouse's benefit rewritten and the other's untouched, with
 * the household's Social Security total then wrong and nothing flagging it. Both writes go
 * through one transaction handle instead. Deliberately narrow: six known columns, parsed
 * strictly, so it can never grow into a second income core.
 */
export async function claimSocialSecurityForReturn(a: Common & { rows: Array<{ incomeId: string; patch: Record<string, unknown> }> }): R {
  const denied = await gate(a);
  if (denied) return denied;
  if (a.rows.length === 0) return writeError(400, "No Social Security row to write");
  const writes: Array<{ incomeId: string; patch: z.infer<typeof ssClaimPatchSchema> }> = [];
  for (const r of a.rows) {
    const parsed = ssClaimPatchSchema.safeParse(r.patch);
    if (!parsed.success) return writeError(400, summarizeZodIssues(parsed.error));
    writes.push({ incomeId: r.incomeId, patch: parsed.data });
  }

  try {
    await db.transaction(async (tx) => {
      for (const { incomeId, patch } of writes) {
        const [row] = await tx.update(incomes).set({
          ssBenefitMode: patch.ssBenefitMode, claimingAgeMode: patch.claimingAgeMode, claimingAge: patch.claimingAge,
          startYear: patch.startYear, inflationStartYear: patch.inflationStartYear, annualAmount: String(patch.annualAmount),
          updatedAt: new Date(),
        }).where(and(eq(incomes.id, incomeId), eq(incomes.clientId, a.clientId))).returning({ id: incomes.id });
        // Throwing rolls the sibling write back with it: a benefit row that is not this
        // household's is a 404, never a half-applied split.
        if (!row) throw new IncomeRowMissingError(incomeId);
      }
    });
  } catch (err) {
    if (err instanceof IncomeRowMissingError) return writeError(404, "Income not found");
    console.error("[tax-reconciliation] Social Security claim write failed:", err);
    return writeError(500, "Could not record the Social Security benefit");
  }

  for (const { incomeId } of writes) {
    await recordAudit({ action: "income.update", resourceType: "income", resourceId: incomeId, clientId: a.clientId, firmId: a.firmId, actorId: a.actorId, metadata: { ...a.crossFirmMeta, ssClaim: true, source: "plan_vs_return" } });
  }
  return { ok: true, data: { id: writes[0].incomeId }, resourceId: writes[0].incomeId };
}
