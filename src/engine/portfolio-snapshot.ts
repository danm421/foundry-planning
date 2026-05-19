import type { Account, GiftEvent, ProjectionYear } from "./types";
import { ownersForYear } from "./ownership";

/** Minimal entity metadata the portfolio snapshot needs. The projection's
 *  entityMap rows are wider; this structural type keeps the helper decoupled. */
type PortfolioEntityMeta = {
  includeInPortfolio?: boolean;
  accessibleToClient?: boolean;
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
}): ProjectionYear["portfolioAssets"] {
  const { workingAccounts, accountBalances, giftEvents, year, planStartYear, entityMap } = args;

  const portfolioAssets = {
    taxable: {} as Record<string, number>,
    cash: {} as Record<string, number>,
    retirement: {} as Record<string, number>,
    realEstate: {} as Record<string, number>,
    business: {} as Record<string, number>,
    lifeInsurance: {} as Record<string, number>,
    trustsAndBusinesses: {} as Record<string, number>,
    accessibleTrustAssets: {} as Record<string, number>,
    taxableTotal: 0,
    cashTotal: 0,
    retirementTotal: 0,
    realEstateTotal: 0,
    businessTotal: 0,
    lifeInsuranceTotal: 0,
    trustsAndBusinessesTotal: 0,
    accessibleTrustAssetsTotal: 0,
    total: 0,
  };
  const categoryToKey: Record<string, "taxable" | "cash" | "retirement" | "realEstate" | "business" | "lifeInsurance"> = {
    taxable: "taxable",
    cash: "cash",
    retirement: "retirement",
    real_estate: "realEstate",
    business: "business",
    life_insurance: "lifeInsurance",
  };
  for (const acct of workingAccounts) {
    const val = accountBalances[acct.id] ?? 0;
    const portfolioYearOwners = ownersForYear(acct, giftEvents ?? [], year, planStartYear);

    let inPortfolioFraction = portfolioYearOwners
      .filter((o) => o.kind === "family_member")
      .reduce((s, o) => s + o.percent, 0);
    for (const owner of portfolioYearOwners) {
      if (owner.kind !== "entity") continue;
      const entity = entityMap[owner.entityId];
      if (entity?.includeInPortfolio) inPortfolioFraction += owner.percent;
    }
    if (inPortfolioFraction > 0) {
      const inPortfolioVal = val * inPortfolioFraction;
      const key = categoryToKey[acct.category] ?? "taxable";
      portfolioAssets[key][acct.id] = inPortfolioVal;
      const totalKey = `${key}Total` as keyof typeof portfolioAssets;
      (portfolioAssets[totalKey] as number) += inPortfolioVal;

      if (key === "business") {
        portfolioAssets.trustsAndBusinesses[acct.id] =
          (portfolioAssets.trustsAndBusinesses[acct.id] ?? 0) + inPortfolioVal;
        portfolioAssets.trustsAndBusinessesTotal += inPortfolioVal;
      }
    }

    for (const owner of portfolioYearOwners) {
      if (owner.kind !== "entity") continue;
      const entity = entityMap[owner.entityId];
      if (!entity || entity.includeInPortfolio) continue;
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
    portfolioAssets.lifeInsuranceTotal;

  return portfolioAssets;
}
