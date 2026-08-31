// src/lib/presentations/shared/tax-type-composition.ts
import type { Account, ProjectionYear } from "@/engine/types";

/** Portfolio at a point in time, split by how it will be taxed on the way out. */
export interface AssetsByTaxType {
  roth: number;
  preTax: number;
  taxable: number;
  total: number;
}

/**
 * The retirement-year portfolio split Roth / pre-tax / taxable.
 *
 * Reads the engine's `portfolioAssets` buckets — the *same* source as the
 * "by type" column beside it on the page — so the two columns always total the
 * same number. Reading whole-account ledgers instead gave one page two answers
 * for one snapshot: the buckets hold the household's *owned share* of an
 * account, while a ledger holds 100% of it.
 *
 * Cash is taxable: it is spendable now and its interest is ordinary income, so
 * it belongs in the taxable bucket rather than nowhere at all.
 *
 * Roth is the full balance of a `roth_ira` plus the designated-Roth slice
 * inside a 401(k)/403(b) (`rothValueEoY`), scaled to the owned share. An
 * account the projection created mid-flight is in the buckets but absent from
 * `accounts`; it counts as pre-tax rather than vanishing from the total.
 */
export function assetsByTaxTypeAt(
  py: Pick<ProjectionYear, "portfolioAssets" | "accountLedgers">,
  accounts: Account[],
): AssetsByTaxType {
  const bySubType = new Map(accounts.map((a) => [a.id, a.subType]));
  let roth = 0, preTax = 0;

  for (const [id, owned] of Object.entries(py.portfolioAssets.retirement)) {
    const led = py.accountLedgers[id];
    const whole = led?.endingValue ?? 0;
    const subType = bySubType.get(id);
    const wholeRoth =
      subType === "roth_ira" ? whole
      : subType === "401k" || subType === "403b" ? (led?.rothValueEoY ?? 0)
      : 0;
    // The bucket is `whole × ownedFraction`; scale the Roth slice by the same
    // fraction so the two halves still sum to the bucket.
    const ownedRoth = whole > 0 ? wholeRoth * (owned / whole) : 0;
    roth += ownedRoth;
    preTax += owned - ownedRoth;
  }

  const sum = (bucket: Record<string, number>) =>
    Object.values(bucket).reduce((s, v) => s + v, 0);
  const taxable = sum(py.portfolioAssets.taxable) + sum(py.portfolioAssets.cash);

  return { roth, preTax, taxable, total: roth + preTax + taxable };
}
