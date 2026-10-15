// src/lib/clients/disability-policies-writes.ts
/**
 * Disability policy create and update — the write paths of
 * disability-policies/route.ts (POST) and [policyId]/route.ts (PATCH), moved
 * here so the fact finder save can run them on its transaction. The routes keep
 * their gates and their responses. Client-level: no scenario lookup; tenancy
 * lives in the query. Without `tx` each is one statement on module `db`, as
 * before; with it, the write and its audit row ride the caller's transaction.
 */
import { and, eq } from "drizzle-orm";
import { disabilityPolicies, type DisabilityPolicyRow, type NewDisabilityPolicyRow } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { handleOf, type WriteOptions } from "@/lib/db-tx";
import { formatZodIssues } from "@/lib/schemas/common";
import { disabilityPolicyCreateSchema, disabilityPolicyUpdateSchema } from "@/lib/schemas/disability-policies";
import { writeError, type EntityWriteResult } from "./entity-write-result";

/** decimal columns are strings on the wire; `null` STAYS null. An uncapped
 *  monthly max must never become "0" — that pays nothing, silently. */
const dec = (v: number | null | undefined): string | null =>
  v == null ? null : String(v);

type PolicyArgs = {
  clientId: string;
  firmId: string;
  /** The route passes none (the audit row falls back to the session); the save passes the advisor. */
  actorId?: string;
  input: unknown;
  crossFirmMeta?: Record<string, unknown>;
} & WriteOptions;

export async function createDisabilityPolicyForClient(args: PolicyArgs): Promise<EntityWriteResult<DisabilityPolicyRow>> {
  const { clientId, firmId, actorId, input, crossFirmMeta } = args;
  const parsed = disabilityPolicyCreateSchema.safeParse(input);
  if (!parsed.success) {
    const issues = formatZodIssues(parsed.error);
    return writeError(400, "Invalid body", { error: "Invalid body", issues });
  }
  const d = parsed.data;

  const [row] = await handleOf(args)
    .insert(disabilityPolicies)
    .values({
      clientId,
      name: d.name,
      insured: d.insured,
      carrier: d.carrier ?? null,
      coveredEarningsMode: d.coveredEarningsMode,
      coveredEarningsAmount: dec(d.coveredEarningsAmount),
      hasShortTerm: d.hasShortTerm,
      stdEliminationDays: d.stdEliminationDays,
      stdBenefitPct: String(d.stdBenefitPct),
      stdDurationWeeks: d.stdDurationWeeks,
      stdMonthlyMax: dec(d.stdMonthlyMax),
      hasLongTerm: d.hasLongTerm,
      ltdEliminationDays: d.ltdEliminationDays,
      ltdBenefitPct: String(d.ltdBenefitPct),
      ltdMonthlyMax: dec(d.ltdMonthlyMax),
      ltdBenefitPeriodMode: d.ltdBenefitPeriodMode,
      ltdBenefitPeriodAge: d.ltdBenefitPeriodAge ?? null,
      ltdBenefitPeriodYears: d.ltdBenefitPeriodYears ?? null,
      benefitTaxable: d.benefitTaxable,
      colaRate: String(d.colaRate),
      annualPremium: String(d.annualPremium),
      premiumPayer: d.premiumPayer,
      notes: d.notes ?? null,
    })
    .returning();

  await recordAudit({
    action: "disability_policy.create",
    resourceType: "disability_policy",
    resourceId: row.id,
    clientId,
    firmId,
    actorId,
    metadata: { name: d.name, ...(crossFirmMeta ?? {}) },
    tx: args.tx,
  });

  return { ok: true, data: row, resourceId: row.id };
}

export async function updateDisabilityPolicyForClient(
  args: PolicyArgs & { policyId: string },
): Promise<EntityWriteResult<DisabilityPolicyRow>> {
  const { clientId, firmId, actorId, policyId, input, crossFirmMeta } = args;
  const parsed = disabilityPolicyUpdateSchema.safeParse(input);
  if (!parsed.success) {
    const issues = formatZodIssues(parsed.error);
    return writeError(400, "Invalid body", { error: "Invalid body", issues });
  }
  const d = parsed.data;

  // Build the patch from ONLY the keys the body actually carried. Never
  // `.set(parsed.data)` — that is the mass-assignment shape flagged across
  // this repo, and `strictPartial` is what keeps an absent key absent.
  const patch: Partial<NewDisabilityPolicyRow> = {};
  if (d.name !== undefined) patch.name = d.name;
  if (d.insured !== undefined) patch.insured = d.insured;
  if (d.carrier !== undefined) patch.carrier = d.carrier ?? null;
  if (d.coveredEarningsMode !== undefined) {
    patch.coveredEarningsMode = d.coveredEarningsMode;
  }
  if (d.coveredEarningsAmount !== undefined) {
    patch.coveredEarningsAmount = dec(d.coveredEarningsAmount);
  }
  if (d.hasShortTerm !== undefined) patch.hasShortTerm = d.hasShortTerm;
  if (d.stdEliminationDays !== undefined) {
    patch.stdEliminationDays = d.stdEliminationDays;
  }
  if (d.stdBenefitPct !== undefined) {
    patch.stdBenefitPct = String(d.stdBenefitPct);
  }
  if (d.stdDurationWeeks !== undefined) {
    patch.stdDurationWeeks = d.stdDurationWeeks;
  }
  if (d.stdMonthlyMax !== undefined) patch.stdMonthlyMax = dec(d.stdMonthlyMax);
  if (d.hasLongTerm !== undefined) patch.hasLongTerm = d.hasLongTerm;
  if (d.ltdEliminationDays !== undefined) {
    patch.ltdEliminationDays = d.ltdEliminationDays;
  }
  if (d.ltdBenefitPct !== undefined) {
    patch.ltdBenefitPct = String(d.ltdBenefitPct);
  }
  if (d.ltdMonthlyMax !== undefined) patch.ltdMonthlyMax = dec(d.ltdMonthlyMax);
  if (d.ltdBenefitPeriodMode !== undefined) {
    patch.ltdBenefitPeriodMode = d.ltdBenefitPeriodMode;
  }
  if (d.ltdBenefitPeriodAge !== undefined) {
    patch.ltdBenefitPeriodAge = d.ltdBenefitPeriodAge ?? null;
  }
  if (d.ltdBenefitPeriodYears !== undefined) {
    patch.ltdBenefitPeriodYears = d.ltdBenefitPeriodYears ?? null;
  }
  if (d.benefitTaxable !== undefined) patch.benefitTaxable = d.benefitTaxable;
  if (d.colaRate !== undefined) patch.colaRate = String(d.colaRate);
  if (d.annualPremium !== undefined) {
    patch.annualPremium = String(d.annualPremium);
  }
  if (d.premiumPayer !== undefined) patch.premiumPayer = d.premiumPayer;
  if (d.notes !== undefined) patch.notes = d.notes ?? null;
  patch.updatedAt = new Date();

  // Tenant-isolation lives INSIDE the query: a policy id belonging to
  // another client matches nothing, so `.returning()` is empty and the
  // caller gets a 404 rather than a row they should never see.
  const [row] = await handleOf(args)
    .update(disabilityPolicies)
    .set(patch)
    .where(and(eq(disabilityPolicies.id, policyId), eq(disabilityPolicies.clientId, clientId)))
    .returning();

  if (!row) return writeError(404, "Policy not found");

  await recordAudit({
    action: "disability_policy.update",
    resourceType: "disability_policy",
    resourceId: policyId,
    clientId,
    firmId,
    actorId,
    metadata: { name: row.name, fieldsChanged: Object.keys(d), ...(crossFirmMeta ?? {}) },
    tx: args.tx,
  });

  return { ok: true, data: row, resourceId: policyId };
}
