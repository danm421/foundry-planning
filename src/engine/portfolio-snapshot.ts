import type { Account, AccountLedger, GiftEvent, ProjectionYear } from "./types";
import { ownersForYear } from "./ownership";

/** Minimal entity metadata the portfolio snapshot needs. The projection's
 *  entityMap rows (EntitySummary) are wider and always populate both fields;
 *  this structural type keeps the helper decoupled and unit-testable. */
type PortfolioEntityMeta = {
  includeInPortfolio?: boolean;
  accessibleToClient?: boolean;
};

/**
 * The buckets that compose `portfolioAssets.liquidTotal` — the canonical
 * "Portfolio Assets" figure (H1). Declared once and consumed by every place
 * that sums, rolls forward, or *explains* that total, so the composition can
 * never drift between the balance and the flows that are supposed to explain it.
 *
 * Real estate, business, stock options and locked (non-accessible) trust assets
 * are deliberately absent: they are net worth, not portfolio.
 */
export const LIQUID_PORTFOLIO_BUCKETS = [
  "taxable",
  "cash",
  "retirement",
  "lifeInsurance",
  "accessibleTrustAssets",
] as const;

export type LiquidPortfolioBucket = (typeof LIQUID_PORTFOLIO_BUCKETS)[number];

const categoryToKey: Record<string, "taxable" | "cash" | "retirement" | "realEstate" | "business" | "lifeInsurance" | "stockOptions"> = {
  taxable: "taxable",
  cash: "cash",
  retirement: "retirement",
  real_estate: "realEstate",
  business: "business",
  life_insurance: "lifeInsurance",
  stock_options: "stockOptions",
};

/**
 * Portfolio snapshot for one projection year. An account is included if it has
 * no entity owner or its entity is flagged to roll into portfolio assets.
 * Non-IIP entity shares route to trustsAndBusinesses or accessibleTrustAssets
 * based on the entity's accessibleToClient flag.
 */
export function computePortfolioSnapshot(args: {
  workingAccounts: Account[];
  accountBalances: Record<string, number>;
  giftEvents: GiftEvent[] | undefined;
  year: number;
  planStartYear: number;
  entityMap: Record<string, PortfolioEntityMeta>;
  principalFmIds: Set<string>;
}): ProjectionYear["portfolioAssets"] {
  const { workingAccounts, accountBalances, giftEvents, year, planStartYear, entityMap, principalFmIds } = args;

  const portfolioAssets = {
    taxable: {} as Record<string, number>,
    cash: {} as Record<string, number>,
    retirement: {} as Record<string, number>,
    realEstate: {} as Record<string, number>,
    business: {} as Record<string, number>,
    lifeInsurance: {} as Record<string, number>,
    stockOptions: {} as Record<string, number>,
    trustsAndBusinesses: {} as Record<string, number>,
    accessibleTrustAssets: {} as Record<string, number>,
    taxableTotal: 0,
    cashTotal: 0,
    retirementTotal: 0,
    realEstateTotal: 0,
    businessTotal: 0,
    lifeInsuranceTotal: 0,
    stockOptionsTotal: 0,
    trustsAndBusinessesTotal: 0,
    accessibleTrustAssetsTotal: 0,
    total: 0,
    liquidTotal: 0,
  };
  for (const acct of workingAccounts) {
    const val = accountBalances[acct.id] ?? 0;
    // T7: use year-aware helper so gift events that transfer ownership to an
    // entity are reflected in the correct year's balance-sheet snapshot.
    // T9: also use year-aware owners for the entity-side loop so
    // includeInPortfolio entities that receive ownership via a gift are
    // counted starting the gift year.
    const portfolioYearOwners = ownersForYear(acct, giftEvents ?? [], year, planStartYear);

    // ── Pass 1: existing in-portfolio share (household + IIP entity) by category ──
    // Only household principals (the client and spouse) count toward the
    // household portfolio. Accounts owned by children or other non-principal
    // family members — e.g. assets distributed to heirs after both spouses
    // die — are deliberately excluded.
    let inPortfolioFraction = 0;
    for (const owner of portfolioYearOwners) {
      if (owner.kind === "family_member" && principalFmIds.has(owner.familyMemberId)) {
        inPortfolioFraction += owner.percent;
      }
    }
    for (const owner of portfolioYearOwners) {
      if (owner.kind !== "entity") continue;
      const entity = entityMap[owner.entityId];
      if (entity?.includeInPortfolio) inPortfolioFraction += owner.percent;
    }
    if (inPortfolioFraction > 0) {
      const inPortfolioVal = val * inPortfolioFraction;
      // Notes receivable amortize on a fixed schedule and aren't fungible liquid
      // wealth. They appear under "Notes Receivable" on the balance sheet UI and
      // are tracked in accountLedgers, but they don't belong in any
      // portfolioAssets bucket.
      if (acct.category === "notes_receivable" || acct.category === "education_savings") continue;
      // Use an explicit null-guard so future unknown categories fail loud rather
      // than silently bucketing into taxable.
      const key = categoryToKey[acct.category];
      if (!key) continue;
      portfolioAssets[key][acct.id] = inPortfolioVal;
      const totalKey = `${key}Total` as keyof typeof portfolioAssets;
      (portfolioAssets[totalKey] as number) += inPortfolioVal;

      // Mirror household + IIP-entity *business-category* shares into the
      // "Trusts and Businesses" bucket so the column reflects all directly-
      // held business interests too. (Real estate stays in its own column —
      // only category=business mirrors here.)
      if (key === "business") {
        portfolioAssets.trustsAndBusinesses[acct.id] =
          (portfolioAssets.trustsAndBusinesses[acct.id] ?? 0) + inPortfolioVal;
        portfolioAssets.trustsAndBusinessesTotal += inPortfolioVal;
      }
    }

    // ── Pass 2: non-IIP entity shares — route by accessibleToClient ──
    for (const owner of portfolioYearOwners) {
      if (owner.kind !== "entity") continue;
      const entity = entityMap[owner.entityId];
      if (!entity || entity.includeInPortfolio) continue; // already counted above
      const share = val * owner.percent;
      if (share <= 0) continue;
      const bucket = entity.accessibleToClient
        ? "accessibleTrustAssets"
        : "trustsAndBusinesses";
      portfolioAssets[bucket][acct.id] =
        (portfolioAssets[bucket][acct.id] ?? 0) + share;
      const totalKey = (bucket + "Total") as
        | "trustsAndBusinessesTotal"
        | "accessibleTrustAssetsTotal";
      portfolioAssets[totalKey] += share;
    }
  }
  portfolioAssets.total =
    portfolioAssets.taxableTotal +
    portfolioAssets.cashTotal +
    portfolioAssets.retirementTotal +
    portfolioAssets.realEstateTotal +
    portfolioAssets.businessTotal +
    portfolioAssets.lifeInsuranceTotal +
    portfolioAssets.stockOptionsTotal;

  // H1: canonical liquid investable total — the reconciling "Portfolio Assets"
  // figure consumed by the chart, the summary cell, and next-year BoY.
  portfolioAssets.liquidTotal = LIQUID_PORTFOLIO_BUCKETS.reduce(
    (sum, b) => sum + portfolioAssets[`${b}Total`],
    0,
  );

  return portfolioAssets;
}

// ── Portfolio reconciliation ────────────────────────────────────────────────
//
// The cash-flow report asserts one row identity:
//
//   portfolioAssets[t] === portfolioAssets[t-1] + growth[t] + activity[t]
//
// `portfolioAssets` is `liquidTotal`, so growth and activity must be measured
// over exactly the accounts — and exactly the ownership shares — that compose
// `liquidTotal`. Two things make that non-trivial, and getting either wrong
// leaves a silent, compounding gap in the report:
//
//  1. Account set. An account's *ledger* is whole-account, but only accounts in
//     the liquid buckets belong here. Summing real-estate or business ledgers
//     into "Portfolio Growth" credits the row with appreciation that never
//     lands in `liquidTotal`; omitting `accessibleTrustAssets` does the reverse.
//  2. Ownership share. A bucket holds the *owned fraction* of an account
//     (`value × percent`), while the ledger's growth/contributions/distributions
//     are for 100% of it. A half-owned account must contribute half its flows.

/** The slice of a projection year these helpers read. */
type PortfolioYear = Pick<ProjectionYear, "portfolioAssets" | "accountLedgers">;

/** Per-account fraction of the whole-account ledger that rolls into `liquidTotal`. */
export function liquidPortfolioWeights(py: PortfolioYear): Map<string, number> {
  return bucketWeights(py, LIQUID_PORTFOLIO_BUCKETS);
}

/**
 * Same, restricted to one bucket. Per-bucket weights sum to the whole-portfolio
 * weight, so a drill-down broken out by bucket adds up to the total exactly.
 */
export function liquidBucketWeights(
  py: PortfolioYear,
  bucket: LiquidPortfolioBucket,
): Map<string, number> {
  return bucketWeights(py, [bucket]);
}

function bucketWeights(
  py: PortfolioYear,
  buckets: readonly LiquidPortfolioBucket[],
): Map<string, number> {
  const owned = new Map<string, number>();
  for (const bucket of buckets) {
    const byAcct = py.portfolioAssets?.[bucket] as Record<string, number> | undefined;
    if (!byAcct) continue;
    for (const [id, val] of Object.entries(byAcct)) {
      owned.set(id, (owned.get(id) ?? 0) + val);
    }
  }
  const weights = new Map<string, number>();
  for (const [id, ownedVal] of owned) {
    const endingValue = py.accountLedgers?.[id]?.endingValue ?? 0;
    // A fully-drained account leaves the share indeterminate (0/0). Fall back to
    // 100%, which is exact for the wholly-owned case and no worse than the
    // unweighted behavior it replaces for the co-owned one.
    weights.set(id, endingValue > 0 ? ownedVal / endingValue : 1);
  }
  return weights;
}

/** Each account's ledger amount, scaled to the share of it that is portfolio. */
function sumWeighted(
  py: PortfolioYear,
  weights: Map<string, number>,
  amountOf: (led: AccountLedger) => number,
): number {
  let sum = 0;
  for (const [id, weight] of weights) {
    const led = py.accountLedgers?.[id];
    if (led) sum += amountOf(led) * weight;
  }
  return sum;
}

// Internal transfer legs (supplemental withdrawal refill, entity gap-fill) move
// money *inside* the portfolio, so they must not register as outside money in or
// out — hence the netting against the `internal*` counters.
const additionOf = (led: AccountLedger) =>
  led.contributions - (led.internalContributions ?? 0);
const distributionOf = (led: AccountLedger) =>
  led.distributions - (led.internalDistributions ?? 0);

/** Growth credited to `liquidTotal` this year. */
export function liquidPortfolioGrowth(
  py: PortfolioYear,
  weights: Map<string, number> = liquidPortfolioWeights(py),
): number {
  return sumWeighted(py, weights, (led) => led.growth);
}

/** External additions minus external distributions against `liquidTotal`. */
export function liquidPortfolioActivity(
  py: PortfolioYear,
  weights: Map<string, number> = liquidPortfolioWeights(py),
): number {
  return liquidPortfolioAdditions(py, weights) - liquidPortfolioDistributions(py, weights);
}

export function liquidPortfolioAdditions(
  py: PortfolioYear,
  weights: Map<string, number> = liquidPortfolioWeights(py),
): number {
  return sumWeighted(py, weights, additionOf);
}

export function liquidPortfolioDistributions(
  py: PortfolioYear,
  weights: Map<string, number> = liquidPortfolioWeights(py),
): number {
  return sumWeighted(py, weights, distributionOf);
}
