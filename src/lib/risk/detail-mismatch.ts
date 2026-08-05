// Resolves the "does the plan actually run on the portfolio this profile calls
// for" readout. Lifted out of the Risk detail page so the PDF export renders
// the same section from the same derivation rather than a second copy of it.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { planSettings } from "@/db/schema";
import { resolveScenarioId } from "@/lib/compute-cache/resolve-scenario-id";
import { resolveRiskPortfolioId, getPortfolioNames } from "@/lib/cma/resolve-risk-portfolio";
import type { RiskLevel } from "@/lib/risk-levels";
import {
  describeBucketSource,
  describeMismatch,
  effectiveScenarioPortfolioId,
  type BucketReadout,
  type MismatchState,
} from "./portfolio-mismatch";

/**
 * A household with no base scenario / plan settings throws inside
 * `resolveScenarioId` -- same "not an error page" treatment the capacity guard
 * gets. Falling back to `no_profile` renders nothing rather than crashing a
 * page that works fine for a planless household today.
 */
export async function resolveMismatchState(args: {
  clientId: string;
  firmId: string;
  compositeLevel: RiskLevel | null;
}): Promise<MismatchState> {
  if (!args.compositeLevel) return { kind: "no_profile" };

  try {
    // resolveRiskPortfolioId needs only firmId + compositeLevel, both known
    // before this block, so it rides alongside the scenario lookup instead of
    // queueing behind it. getPortfolioNames genuinely must stay last -- it
    // needs ids from both.
    const [settingsRows, profilePortfolioId] = await Promise.all([
      resolveScenarioId(args.clientId, "base").then((baseScenarioId) =>
        db
          .select({
            growthSourceTaxable: planSettings.growthSourceTaxable,
            growthSourceRetirement: planSettings.growthSourceRetirement,
            modelPortfolioIdTaxable: planSettings.modelPortfolioIdTaxable,
            modelPortfolioIdRetirement: planSettings.modelPortfolioIdRetirement,
            defaultGrowthTaxable: planSettings.defaultGrowthTaxable,
            defaultGrowthRetirement: planSettings.defaultGrowthRetirement,
          })
          .from(planSettings)
          .where(eq(planSettings.scenarioId, baseScenarioId)),
      ),
      resolveRiskPortfolioId(args.firmId, args.compositeLevel),
    ]);
    const [settings] = settingsRows;
    const names = await getPortfolioNames(args.firmId, [
      settings?.modelPortfolioIdTaxable,
      settings?.modelPortfolioIdRetirement,
      profilePortfolioId,
    ]);
    // No plan settings row -> no buckets to describe. The card still renders
    // its headline; describeMismatch treats a null scenario portfolio as a
    // mismatch, which is the intended reading.
    const buckets: BucketReadout[] = settings
      ? [
          {
            label: "Taxable",
            value: describeBucketSource({
              source: settings.growthSourceTaxable,
              portfolioId: settings.modelPortfolioIdTaxable,
              customRate: settings.defaultGrowthTaxable,
              portfolioNames: names,
            }),
          },
          {
            label: "Retirement",
            value: describeBucketSource({
              source: settings.growthSourceRetirement,
              portfolioId: settings.modelPortfolioIdRetirement,
              customRate: settings.defaultGrowthRetirement,
              portfolioNames: names,
            }),
          },
        ]
      : [];
    return describeMismatch({
      compositeLevel: args.compositeLevel,
      profilePortfolioId,
      profilePortfolioName: profilePortfolioId ? (names.get(profilePortfolioId) ?? null) : null,
      scenarioPortfolioId: effectiveScenarioPortfolioId(settings ?? null),
      buckets,
    });
  } catch {
    return { kind: "no_profile" };
  }
}
