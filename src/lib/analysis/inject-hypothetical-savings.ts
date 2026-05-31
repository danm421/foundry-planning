// src/lib/analysis/inject-hypothetical-savings.ts
//
// Shared injection of the synthetic, analysis-only taxable account + self-funding
// savings rule that backs the Retirement Analysis "Minimum Additional Savings"
// column. Used by BOTH the /options solve (which solves its annual contribution)
// and the /project recompute (so an Explore "Additional Taxable Savings" edit
// actually lands on a rule and grows at the chosen rate). One home so the two
// routes can't drift.
import { z } from "zod";
import type { ClientData } from "@/engine/types";
import type { ResolutionContext } from "@/lib/projection/resolve-entity";
import { LEGACY_FM_CLIENT } from "@/engine/ownership";
import { earliestRetirementYear } from "@/lib/analysis/retirement-window";
import {
  buildHypotheticalSavings,
  type GrowthResolverLike,
  type MinSavingsGrowth,
} from "@/lib/analysis/hypothetical-savings";

/** Wire shape for the optional min-savings growth assumption. Both retirement
 *  analysis routes validate against this. */
export const MIN_SAVINGS_GROWTH_SCHEMA = z.union([
  z.object({ kind: z.literal("taxable-default") }),
  z.object({ kind: z.literal("model-portfolio"), portfolioId: z.string().uuid() }),
  z.object({ kind: z.literal("custom-rate"), rate: z.number().min(-1).max(2) }),
]);

/** Human-readable growth assumption for the funding-source sub-line. The UI
 *  renders this verbatim after "growing at". */
export function formatGrowthLabel(growth: MinSavingsGrowth, rate: number): string {
  const pct = `${(rate * 100).toFixed(1)}%`;
  switch (growth.kind) {
    case "custom-rate":
      return `Custom ${pct}`;
    case "model-portfolio":
      return `Model portfolio · ${pct}`;
    case "taxable-default":
      return `Taxable default ${pct}`;
  }
}

/** Conservative flat fallback when no resolver is available (e.g. a base load
 *  without a resolution context, or a unit test). Mirrors the prior inline
 *  default in the /options route. */
const FALLBACK_RESOLVER: GrowthResolverLike = {
  resolveCategoryDefault: () => ({ rate: 0.05 }),
  resolvePortfolio: () => ({ geoReturn: 0.05, pctOi: 0, pctLtcg: 0, pctQdiv: 0, pctTaxEx: 0 }),
};

/**
 * Appends the synthetic taxable account + self-funding rule to `effectiveTree`
 * IN PLACE (matching the prior /options pattern; the tree is request-scoped, and
 * `/project` deep-clones it again inside applyMutations). The rule starts at
 * annualAmount 0 — inert until a `savings-contribution` mutation on
 * SYNTHETIC_SAVINGS_ACCOUNT_ID raises it. Returns the pre-formatted growth label
 * for the /options funding-source payload (/project ignores it).
 */
export function injectHypotheticalSavings(
  effectiveTree: ClientData,
  growth: MinSavingsGrowth,
  resolutionContext?: ResolutionContext,
): { growthLabel: string } {
  const resolver: GrowthResolverLike = resolutionContext?.resolver ?? FALLBACK_RESOLVER;
  const ownerFamilyMemberId =
    effectiveTree.familyMembers?.find((m) => m.role === "client")?.id ?? LEGACY_FM_CLIENT;
  const { account, rule } = buildHypotheticalSavings(growth, resolver, {
    startYear: effectiveTree.planSettings.planStartYear,
    endYear: earliestRetirementYear(effectiveTree.client),
    ownerFamilyMemberId,
  });
  effectiveTree.accounts = [...effectiveTree.accounts, account];
  effectiveTree.savingsRules = [...effectiveTree.savingsRules, rule];
  return { growthLabel: formatGrowthLabel(growth, account.growthRate) };
}
