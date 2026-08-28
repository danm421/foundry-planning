// src/lib/inline-edit/growth-options.ts
//
// The Household Map's growth-rate dropdown offers exactly what the full account
// editor offers for that category — no more. Two editors of one field that
// disagree is a bug factory, so this mirrors `add-account-form.tsx` rather than
// offering what the engine could technically honour.
//
// Known mirrored inconsistency: `resolve-entity.ts:199-213` honours "inflation"
// for `business` as well as `real_estate`, but the form gives business a bare
// percent box. We mirror the form. Logged in future-work/ui.md.
import { ASSET_MIX_CATEGORIES, INFLATION_CATEGORIES } from "@/components/forms/growth-rate-field";

/** Which control a category gets. Mirrors `usesGrowthDropdown` and the
 *  `category === "real_estate"` / `category !== "stock_options"` branches in
 *  add-account-form.tsx. `life_insurance` is "none" because policies are out of
 *  scope for the Map entirely. */
export type GrowthEditMode = "full" | "inflation_custom" | "custom_only" | "none";

const FULL_DROPDOWN_CATEGORIES = ["taxable", "cash", "retirement", "education_savings", "annuity"];

export function growthEditModeFor(category: string): GrowthEditMode {
  if (FULL_DROPDOWN_CATEGORIES.includes(category)) return "full";
  if (category === "real_estate") return "inflation_custom";
  if (category === "stock_options" || category === "life_insurance") return "none";
  return "custom_only";
}

export interface GrowthOption {
  /** Raw select value — "default" | "mp:<id>" | "tp:<id>" | "asset_mix" | "inflation" | "custom".
   *  Feed to `parseGrowthSourceSelection` to get the persisted fields. */
  value: string;
  label: string;
}

export interface GrowthOptionsArgs {
  category: string;
  modelPortfolios: readonly { id: string; name: string; blendedReturn: number }[];
  fundPortfolios: readonly { id: string; name: string; blendedReturnPct: number | null }[];
  resolvedInflationRate: number;
  defaultPctForCategory: number | null;
  assetMixBlendedPct: number | null;
  /** True when the account has no holdings to back a NEWLY chosen asset mix.
   *  Never suppresses the source the account already stores. */
  hideAssetMix: boolean;
  /** The account's persisted `growth_source`. An account already on a source is
   *  always offered it, whatever its category. */
  currentSource?: string;
}

/**
 * The "Inflation rate" option's label.
 *
 * Exported because `FlowGrowthCell` offers the same option and has no account
 * category to route through `growthOptionsFor` \u2014 and two dropdowns over one
 * field whose labels disagree is exactly what this module exists to prevent.
 */
export function inflationRateOptionLabel(resolvedInflationRate: number): string {
  return `${(resolvedInflationRate * 100).toFixed(2)}% \u2014 Inflation rate`;
}

export function growthOptionsFor(args: GrowthOptionsArgs): GrowthOption[] {
  const mode = growthEditModeFor(args.category);
  if (mode === "none") return [];

  const inflationLabel = inflationRateOptionLabel(args.resolvedInflationRate);

  if (mode === "custom_only") return [{ value: "custom", label: "Custom %" }];
  if (mode === "inflation_custom") {
    // Order mirrors the real editor at `add-account-form.tsx` (the real_estate
    // branch renders Custom % first, then Inflation rate). Controller
    // resolution R11: this module exists to mirror the form, and mirroring
    // includes the order the advisor reads.
    return [
      { value: "custom", label: "Custom %" },
      { value: "inflation", label: inflationLabel },
    ];
  }

  const out: GrowthOption[] = [
    {
      value: "default",
      label:
        args.defaultPctForCategory !== null
          ? `${args.defaultPctForCategory}% \u2014 Plan default`
          : "Plan default",
    },
  ];
  for (const mp of args.modelPortfolios) {
    out.push({ value: `mp:${mp.id}`, label: `${(mp.blendedReturn * 100).toFixed(2)}% \u2014 ${mp.name}` });
  }
  for (const fp of args.fundPortfolios) {
    if (fp.blendedReturnPct === null) continue; // needs classified holdings
    out.push({ value: `tp:${fp.id}`, label: `${fp.blendedReturnPct.toFixed(2)}% \u2014 ${fp.name}` });
  }
  // A <select> whose value matches no option shows the FIRST one, so dropping
  // the source the account is actually on makes the control read "Plan default"
  // while the engine goes on using the mix — and the next save writes that lie
  // back. `syncAccountFromHoldings` stamps "asset_mix" on ANY holdings-backed
  // account, whatever its category, so cash / annuity / 529 / real-estate rows
  // do arrive already on one. The category list and `hideAssetMix` govern only
  // whether the mix can be picked ANEW.
  if (
    args.currentSource === "asset_mix" ||
    (ASSET_MIX_CATEGORIES.includes(args.category) && !args.hideAssetMix)
  ) {
    out.push({
      value: "asset_mix",
      label:
        args.assetMixBlendedPct !== null
          ? `${args.assetMixBlendedPct.toFixed(2)}% \u2014 Asset mix (custom)`
          : "Asset mix (custom)",
    });
  }
  if (INFLATION_CATEGORIES.includes(args.category)) {
    out.push({ value: "inflation", label: inflationLabel });
  }
  out.push({ value: "custom", label: "Custom %" });
  return out;
}

/** Inverse of `parseGrowthSourceSelection` — turn a persisted row back into the
 *  raw select value, so the open dropdown shows the current selection. */
export function growthSelectValue(row: {
  growthSource?: string;
  modelPortfolioId?: string | null;
  tickerPortfolioId?: string | null;
}): string {
  if (row.growthSource === "model_portfolio") return `mp:${row.modelPortfolioId ?? ""}`;
  if (row.growthSource === "ticker_portfolio") return `tp:${row.tickerPortfolioId ?? ""}`;
  return row.growthSource ?? "default";
}

/** Two decimals: at one, portfolios at 6.24% and 6.21% both render "6.2%" and
 *  the advisor cannot tell which is selected. */
export function formatGrowthPct(rateDecimal: number | string | null): string {
  if (rateDecimal == null) return "—";
  const n = typeof rateDecimal === "string" ? Number(rateDecimal) : rateDecimal;
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(2)}%`;
}
