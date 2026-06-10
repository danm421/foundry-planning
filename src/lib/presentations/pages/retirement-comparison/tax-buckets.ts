import type { Account, ProjectionYear } from "@/engine/types";

/** Liquid portfolio assets split by tax treatment, for one plan at one year. */
export interface TaxBuckets {
  cash: number;
  taxable: number;
  preTax: number;
  roth: number;
  hsa: number;
}

// 401k/403b carry a Roth-designated slice on the ledger (rothValueEoY); the rest
// of these is pre-tax. The dedicated roth_401k/roth_403b subtypes were retired.
// Authoritative subtype taxonomy lives in `src/engine/tax-classification.ts`
// (TAX_DEFERRED_SUBTYPES / ROTH_SUBTYPES) — keep this set aligned with it.
const ROTH_DESIGNATED_SUBTYPES = new Set(["401k", "403b"]);

/** Split the liquid portfolio at one projection year by tax treatment. Cash and
 *  taxable pass through from their category totals; the lumped `retirement`
 *  Record is classified per account (HSA / Roth / pre-tax), splitting any
 *  401k/403b by its Roth-designated ending portion. Unmatched accounts default
 *  to pre-tax (the dominant retirement treatment). */
export function buildTaxBuckets(year: ProjectionYear, accounts: Account[]): TaxBuckets {
  const subTypeById = new Map(accounts.map((a) => [a.id, a.subType]));
  const pa = year.portfolioAssets;
  const out: TaxBuckets = {
    cash: pa.cashTotal,
    taxable: pa.taxableTotal,
    preTax: 0,
    roth: 0,
    hsa: 0,
  };

  for (const [id, value] of Object.entries(pa.retirement)) {
    const subType = subTypeById.get(id);
    if (subType === "hsa") {
      out.hsa += value;
    } else if (subType === "roth_ira") {
      out.roth += value;
    } else if (subType && ROTH_DESIGNATED_SUBTYPES.has(subType)) {
      const roth = Math.min(Math.max(0, year.accountLedgers[id]?.rothValueEoY ?? 0), value);
      out.roth += roth;
      out.preTax += value - roth;
    } else {
      out.preTax += value;
    }
  }

  return out;
}
