// src/lib/clients/annuity-contracts-writes.ts
/**
 * The annuity contract write path, moved verbatim from
 * PUT /api/clients/[id]/annuity-contracts/[accountId] (Plan 4, D3) so the fact
 * finder save can run it on its transaction. The contract is a 1:1 extension
 * of an annuity account, upserted whole: every column comes from the body.
 *
 * The route's test fakes `@/db` with select and insert…onConflictDoUpdate
 * only (no transaction) and mocks `@/lib/audit` as `{ recordAudit }` — keep
 * to those shapes.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, annuityContracts } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { handleOf, type DbOrTx, type WriteOptions } from "@/lib/db-tx";
import { annuityContractSchema, annuityTaxTreatmentFromSubType, QLAC_PREMIUM_CAP_2026 } from "@/lib/schemas/annuities";
import { formatZodIssues } from "@/lib/schemas/common";
import { writeError, type EntityWriteResult } from "./entity-write-result";

// The QLAC cap is a soft warning, not an enforced limit — Foundry flags
// advisor entry, it does not block it. The figure itself lives in
// `@/lib/schemas/annuities` so the panel warns at the same number.

/**
 * Tenant-isolation guard, reused by GET and PUT: confirm the target account
 * exists, belongs to this client, and is an annuity account. A single guard
 * satisfies both "rejects a contract on a non-annuity account" and "scopes to
 * the caller's org" — a cross-client account id fails the `clientId` half of
 * the predicate exactly like a wrong-category account fails the `category`
 * half, and both come back as a 404 "Account not found" rather than leaking
 * which half failed.
 */
export async function findAnnuityAccount(clientId: string, accountId: string, handle?: DbOrTx) {
  const [target] = await (handle ?? db)
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.clientId, clientId),
        eq(accounts.category, "annuity"),
      ),
    );
  return target;
}

/** Decimal columns are strings on the wire from drizzle; convert to numbers
 *  (or null) for the JSON response. Field-for-field symmetric with
 *  `annuityContractSchema`'s body — no `accountId`, which the schema
 *  `.strict()`-rejects as an unknown key and which the caller already has
 *  from the URL — so a GET response can be PUT straight back unmodified. */
export function serializeContract(row: typeof annuityContracts.$inferSelect) {
  const num = (v: string | null): number | null => (v == null ? null : Number(v));
  return {
    carrier: row.carrier,
    contractNumberLast4: row.contractNumberLast4,
    productType: row.productType,
    taxTreatment: row.taxTreatment,
    costBasis: num(row.costBasis),
    surrenderChargePct: num(row.surrenderChargePct),
    surrenderEndYear: row.surrenderEndYear,
    annualFeePct: Number(row.annualFeePct),
    incomeMode: row.incomeMode,
    incomeStartYear: row.incomeStartYear,
    incomeStartYearRef: row.incomeStartYearRef,
    payoutStructure: row.payoutStructure,
    survivorPct: num(row.survivorPct),
    periodCertainYears: row.periodCertainYears,
    benefitBase: num(row.benefitBase),
    rollupRate: num(row.rollupRate),
    rollupEndYear: row.rollupEndYear,
    rollupRatchets: row.rollupRatchets,
    riderFeePct: num(row.riderFeePct),
    payoutPct: num(row.payoutPct),
    annuitizedPayment: num(row.annuitizedPayment),
    expectedReturnYears: num(row.expectedReturnYears),
  };
}

/**
 * Upsert of a 1:1 extension row keyed by accountId. `actorId`: the save's
 * actor; a route leaves it out and the audit reads the session, as before.
 */
export async function upsertAnnuityContractForClient(
  args: {
    clientId: string;
    firmId: string;
    actorId?: string;
    accountId: string;
    input: unknown;
    crossFirmMeta?: Record<string, unknown>;
  } & WriteOptions,
): Promise<EntityWriteResult<{ warnings: string[] }>> {
  const { clientId: id, firmId, actorId, accountId, crossFirmMeta } = args;
  const handle = handleOf(args);

  const target = await findAnnuityAccount(id, accountId, args.tx);
  if (!target) return writeError(404, "Account not found");

  const parsed = annuityContractSchema.safeParse(args.input);
  if (!parsed.success) {
    return writeError(400, "Validation failed", { error: "Validation failed", issues: formatZodIssues(parsed.error) });
  }
  const input = parsed.data;

  // Drizzle takes `numeric` columns as strings. Mirrors `num()` in
  // `serializeContract` above, which does the read half.
  const dec = (v: number | null | undefined) => (v == null ? null : String(v));

  // The account's sub-type IS the tax treatment — `account_sub_type` carries
  // the same three values as `annuity_tax_treatment`. Derived from the row
  // the tenant guard already loaded, so the contract column is a mirror of
  // the account rather than an independently editable second copy that can
  // drift from the Type dropdown the advisor actually sets. A legacy `other`
  // sub-type (one the backfill script has not reached) has no opinion, and
  // the body stands.
  const taxTreatment = annuityTaxTreatmentFromSubType(target.subType) ?? input.taxTreatment;

  // Every column named once here — reused for both the insert values and
  // the upsert's `set`, never a spread of the raw request body or
  // `parsed.data` (the mass-assignment pattern already flagged across ~30
  // sites in this repo).
  const contractFields = {
    carrier: input.carrier ?? null,
    contractNumberLast4: input.contractNumberLast4 ?? null,
    productType: input.productType,
    taxTreatment,
    costBasis: dec(input.costBasis),
    surrenderChargePct: dec(input.surrenderChargePct),
    surrenderEndYear: input.surrenderEndYear ?? null,
    annualFeePct: String(input.annualFeePct),
    incomeMode: input.incomeMode,
    incomeStartYear: input.incomeStartYear ?? null,
    incomeStartYearRef: input.incomeStartYearRef ?? null,
    payoutStructure: input.payoutStructure ?? null,
    survivorPct: dec(input.survivorPct),
    periodCertainYears: input.periodCertainYears ?? null,
    benefitBase: dec(input.benefitBase),
    rollupRate: dec(input.rollupRate),
    rollupEndYear: input.rollupEndYear ?? null,
    rollupRatchets: input.rollupRatchets,
    riderFeePct: dec(input.riderFeePct),
    payoutPct: dec(input.payoutPct),
    annuitizedPayment: dec(input.annuitizedPayment),
    expectedReturnYears: dec(input.expectedReturnYears),
  };

  await handle
    .insert(annuityContracts)
    .values({ accountId, ...contractFields })
    .onConflictDoUpdate({
      target: annuityContracts.accountId,
      set: { ...contractFields, updatedAt: new Date() },
    });

  // QLAC premiums are capped by IRS reg — flagged, never blocked. There is
  // no premium column on annuity_contracts; the premium is the account's
  // own value, already loaded above by the tenant-isolation guard.
  const warnings: string[] = [];
  const accountValue = Number(target.value);
  if (input.productType === "qlac" && accountValue > QLAC_PREMIUM_CAP_2026) {
    warnings.push(
      // Interpolated, never re-typed: a hard-coded figure here would keep
      // quoting the old cap the January the constant is re-indexed, while
      // comparing against the new one.
      `QLAC premiums are capped at $${QLAC_PREMIUM_CAP_2026.toLocaleString()} for 2026 — ` +
        `this account's value of $${accountValue.toLocaleString()} exceeds it.`,
    );
  }

  await recordAudit({
    action: "account.annuity.update",
    resourceType: "annuity_contract",
    resourceId: accountId,
    clientId: id,
    firmId,
    actorId,
    metadata: { productType: input.productType, incomeMode: input.incomeMode, ...crossFirmMeta },
    tx: args.tx,
  });

  return { ok: true, data: { warnings }, resourceId: accountId };
}
