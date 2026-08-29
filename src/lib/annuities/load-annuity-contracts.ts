import { db } from "@/db";
import { annuityContracts } from "@/db/schema";
import { inArray } from "drizzle-orm";
import type { AnnuityContract } from "@/engine/annuity/types";

/** Drizzle hands back decimals as strings, and `Number("0.0100")` is what the
 *  engine's rate guards expect — an unconverted string is not finite and
 *  throws there. `Number(null)` is 0, though, which would silently turn an
 *  unknown cost basis into a fully taxable contract, so nullable money and
 *  rates go through `nOpt`, never `n`. */
const n = (v: string): number => Number(v);
const nOpt = (v: string | null): number | undefined => (v == null ? undefined : Number(v));

/**
 * Turns a stored milestone ref + calendar year into the year income actually
 * starts. Supplied by the caller because milestone resolution needs the
 * client's date of birth, retirement age and plan window — none of which this
 * loader can see. `storedYear` is null when the row leans on the ref alone.
 *
 * Required rather than optional on purpose: a caller who forgets it gets no
 * error, just an annuity whose income never turns on.
 */
export type IncomeStartYearResolver = (
  ref: string | null,
  storedYear: number | null,
) => number;

/**
 * Loads annuity contract rows for a set of account IDs, keyed by account_id.
 *
 * Non-annuity account IDs are silently ignored — callers pre-filter on
 * `category === "annuity"` but this is defensive against a mixed list, matching
 * `loadPoliciesByAccountIds`.
 */
export async function loadAnnuityContractsByAccountIds(
  accountIds: string[],
  resolveIncomeStartYear: IncomeStartYearResolver,
): Promise<Record<string, AnnuityContract>> {
  if (accountIds.length === 0) return {};

  const rows = await db
    .select()
    .from(annuityContracts)
    .where(inArray(annuityContracts.accountId, accountIds));

  const result: Record<string, AnnuityContract> = {};
  for (const r of rows) {
    result[r.accountId] = {
      carrier: r.carrier,
      contractNumberLast4: r.contractNumberLast4,
      productType: r.productType,
      taxTreatment: r.taxTreatment,
      costBasis: nOpt(r.costBasis),
      surrenderChargePct: nOpt(r.surrenderChargePct),
      surrenderEndYear: r.surrenderEndYear,
      annualFeePct: n(r.annualFeePct),
      incomeMode: r.incomeMode,
      // The `annuity_income_needs_start` CHECK is satisfied by the ref alone,
      // so a legal row can carry a NULL year and only a ref. Left unresolved
      // the engine never sees income start and the contract never pays.
      incomeStartYear:
        r.incomeStartYear == null && r.incomeStartYearRef == null
          ? null
          : resolveIncomeStartYear(r.incomeStartYearRef, r.incomeStartYear),
      payoutStructure: r.payoutStructure,
      survivorPct: nOpt(r.survivorPct) ?? null,
      periodCertainYears: r.periodCertainYears,
      benefitBase: nOpt(r.benefitBase),
      rollupRate: nOpt(r.rollupRate),
      rollupEndYear: r.rollupEndYear,
      rollupRatchets: r.rollupRatchets,
      riderFeePct: nOpt(r.riderFeePct),
      payoutPct: nOpt(r.payoutPct),
      annuitizedPayment: nOpt(r.annuitizedPayment),
      expectedReturnYears: nOpt(r.expectedReturnYears),
    };
  }
  return result;
}
