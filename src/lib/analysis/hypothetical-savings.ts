// src/lib/analysis/hypothetical-savings.ts
//
// Pure builder for the synthetic, analysis-only taxable account + self-funding
// savings rule that backs the Retirement Analysis "Minimum Additional Savings"
// column. Never persisted — injected into the effective tree only for the solve.
import type { Account, SavingsRule } from "@/engine/types";
import type {
  ResolvedCategoryDefault,
  ResolvedGrowth,
} from "@/lib/projection/resolve-growth-source";

export const SYNTHETIC_SAVINGS_ACCOUNT_ID = "hypothetical-additional-savings";
export const SYNTHETIC_SAVINGS_RULE_ID = "hypothetical-additional-savings-rule";

export type MinSavingsGrowth =
  | { kind: "taxable-default" }
  | { kind: "model-portfolio"; portfolioId: string }
  | { kind: "custom-rate"; rate: number }; // decimal, e.g. 0.06

/** Structural subset of `createGrowthSourceResolver`'s return value that the
 *  builder consumes. The real resolver satisfies this. */
export interface GrowthResolverLike {
  resolveCategoryDefault: (category: string) => ResolvedCategoryDefault;
  resolvePortfolio: (portfolioId: string) => ResolvedGrowth;
}

export interface HypotheticalSavingsWindow {
  /** First working year (plan start / current year). */
  startYear: number;
  /** Last accumulation year — contributions run through here (typically the
   *  earliest retirement year; the engine's proration gate handles the partial
   *  year). */
  endYear: number;
  /** Family-member id used as the account owner (100%). */
  ownerFamilyMemberId: string;
}

function resolveGrowth(
  growth: MinSavingsGrowth,
  resolver: GrowthResolverLike,
): Pick<Account, "growthRate" | "realization"> {
  if (growth.kind === "custom-rate") {
    // Matches a custom-growth taxable account today: flat rate, no annual
    // realization (gains accrue, realized on withdrawal).
    return { growthRate: growth.rate };
  }
  if (growth.kind === "model-portfolio") {
    const p = resolver.resolvePortfolio(growth.portfolioId);
    return {
      growthRate: p.geoReturn,
      realization: {
        pctOrdinaryIncome: p.pctOi,
        pctLtCapitalGains: p.pctLtcg,
        pctQualifiedDividends: p.pctQdiv,
        pctTaxExempt: p.pctTaxEx,
        turnoverPct: 0,
      },
    };
  }
  // taxable-default
  const d = resolver.resolveCategoryDefault("taxable");
  return d.realization
    ? { growthRate: d.rate, realization: d.realization }
    : { growthRate: d.rate };
}

export function buildHypotheticalSavings(
  growth: MinSavingsGrowth,
  resolver: GrowthResolverLike,
  window: HypotheticalSavingsWindow,
): { account: Account; rule: SavingsRule } {
  const { growthRate, realization } = resolveGrowth(growth, resolver);

  const account: Account = {
    id: SYNTHETIC_SAVINGS_ACCOUNT_ID,
    name: "Hypothetical Additional Savings",
    category: "taxable",
    subType: "brokerage",
    value: 0,
    basis: 0,
    growthRate,
    ...(realization ? { realization } : {}),
    rmdEnabled: false,
    // Solo-owned by the client; titling is irrelevant for a single owner but the
    // field is required by the engine's Account type.
    titlingType: "jtwros",
    owners: [{ kind: "family_member", familyMemberId: window.ownerFamilyMemberId, percent: 1 }],
  };

  const rule: SavingsRule = {
    id: SYNTHETIC_SAVINGS_RULE_ID,
    accountId: SYNTHETIC_SAVINGS_ACCOUNT_ID,
    annualAmount: 0, // the solver sets this via the savings-contribution lever
    rothPercent: 0,
    // Post-tax contribution — no above-the-line deduction (unlike a pre-tax 401k).
    isDeductible: false,
    fundFromExpenseReduction: true,
    startYear: window.startYear,
    endYear: window.endYear,
  };

  return { account, rule };
}
