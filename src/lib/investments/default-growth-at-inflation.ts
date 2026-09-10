// Detects the untouched-plan state where taxable / retirement accounts are
// projected at the INFLATION rate instead of a return assumption.
//
// `plan_settings.growth_source_{taxable,retirement}` both default to
// "inflation" in the schema, and an account's own `growth_source` defaults to
// "default" (= inherit the category). So a plan nobody has set growth on
// compounds its portfolio at the inflation rate and nothing on screen says so —
// the dropdown reads "Plan default", which looks deliberate.
//
// Scope is deliberately the two categories Dan named. 529s and annuities alias
// the retirement source (see growthDefaultCategory in
// lib/projection/resolve-growth-source.ts) and are affected identically, but
// they are not counted here.
import type { ResolutionContext } from "@/lib/projection/resolve-entity";

export const DEFAULT_GROWTH_WATCHED_CATEGORIES = ["taxable", "retirement"] as const;

export type WatchedGrowthCategory = (typeof DEFAULT_GROWTH_WATCHED_CATEGORIES)[number];

export interface DefaultGrowthAtInflation {
  /** Watched categories whose plan default is still "inflation" AND that hold
   *  at least one account inheriting it. Ordered taxable → retirement. */
  categories: WatchedGrowthCategory[];
  /** How many accounts actually inherit the inflation default. */
  accountCount: number;
  /** Their combined balance, for the banner's dollar figure. */
  totalValue: number;
  /** The rate those accounts compound at today, as a decimal (0.025). */
  rate: number;
}

interface DetectArgs {
  accounts: readonly {
    category: string;
    /** Null / "default" = inherit the category default. Anything else is a
     *  deliberate per-account choice and is left alone. */
    growthSource?: string | null;
    value: number;
  }[];
  /** `plan_settings.growth_source_*` for each watched category. */
  categorySources: Partial<Record<WatchedGrowthCategory, string | null | undefined>>;
  /** The rate the engine compounds a category-default account at. Passed in as
   *  a function so the banner quotes the engine's own number rather than a
   *  second, independently-derived notion of "the inflation rate" — see
   *  `detectDefaultGrowthAtInflationFor`. */
  categoryRate: (category: WatchedGrowthCategory) => number;
}

export function detectDefaultGrowthAtInflation({
  accounts,
  categorySources,
  categoryRate,
}: DetectArgs): DefaultGrowthAtInflation | null {
  const stuck = DEFAULT_GROWTH_WATCHED_CATEGORIES.filter(
    (c) => categorySources[c] === "inflation",
  );
  if (stuck.length === 0) return null;

  const categories: WatchedGrowthCategory[] = [];
  let accountCount = 0;
  let totalValue = 0;

  for (const category of stuck) {
    const inheriting = accounts.filter(
      (a) =>
        a.category === category &&
        (a.growthSource == null || a.growthSource === "default"),
    );
    if (inheriting.length === 0) continue;
    categories.push(category);
    accountCount += inheriting.length;
    for (const a of inheriting) totalValue += a.value;
  }

  if (categories.length === 0) return null;
  // Every flagged category resolves through the same inflation lookup, so the
  // first one's rate is the rate for all of them.
  return { categories, accountCount, totalValue, rate: categoryRate(categories[0]) };
}

/** Adapter for the two surfaces that show the banner. Both already hold the
 *  loaded `ResolutionContext`, so both ask the question the same way and off
 *  the same numbers.
 *
 *  `resolveCategoryDefault(cat).rate` is deliberately the rate source. For an
 *  account on `growthSource: "default"`, `resolveAccountFromRaw` falls through
 *  to exactly that call — so this is the number the projection compounds these
 *  accounts at, by construction. `ResolutionContext.resolvedInflationRate` is
 *  a DIFFERENT number: it honours `inflation_rate_source = "custom"`, which
 *  the category-default path never consults (it always reads the Inflation
 *  asset class). Quoting it would print a rate the projection isn't using.
 *
 *  `accounts` is passed in rather than read off the context because each
 *  surface counts the accounts IT displays.
 *
 *  `ctx` is optional because `LoadEffectiveTreeResult.resolutionContext` is. */
export function detectDefaultGrowthAtInflationFor(
  ctx: ResolutionContext | undefined,
  accounts: DetectArgs["accounts"],
): DefaultGrowthAtInflation | null {
  if (!ctx) return null;
  return detectDefaultGrowthAtInflation({
    accounts,
    categorySources: {
      taxable: ctx.resolver.getCategoryGrowthSource("taxable"),
      retirement: ctx.resolver.getCategoryGrowthSource("retirement"),
    },
    categoryRate: (category) => ctx.resolver.resolveCategoryDefault(category).rate,
  });
}
