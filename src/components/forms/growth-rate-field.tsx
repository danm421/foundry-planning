"use client";

import { useId } from "react";
import { PercentInput } from "@/components/percent-input";
import { fieldLabelClassName } from "./input-styles";
import { GrowthSourceSelect, type GrowthChoice } from "./growth-source-select";
import type { GrowthSource } from "@/lib/investments/allocation";

/** Categories whose growth can be driven by a custom asset mix (and that show the asset-mix tab). */
export const ASSET_MIX_CATEGORIES = ["taxable", "retirement"];
export const INFLATION_CATEGORIES = ["cash", "taxable", "retirement"];

export interface GrowthRateModelPortfolio {
  id: string;
  name: string;
  blendedReturn: number; // decimal, e.g. 0.06
}

export interface GrowthRateFieldProps {
  category: string;
  growthSource: GrowthSource;
  modelPortfolioId: string;
  growthRatePct: string;
  modelPortfolios?: GrowthRateModelPortfolio[];
  tickerPortfolioId?: string;
  /** No longer offered as a NEW choice since 2026-09-03 — fund portfolios reach
   *  plans as derived model portfolios, so they arrive in `modelPortfolios`.
   *  Still read to name an account already stored on a `ticker_portfolio`
   *  source, which must keep displaying and round-tripping correctly. */
  fundPortfolios?: { id: string; name: string; blendedReturnPct: number | null }[];
  /** Resolved category-default % (0–100) or null when unknown. */
  defaultPctForCategory: number | null;
  /** Portfolio name shown in the "(default)" option label. */
  catDefaultPortfolioName?: string | null;
  /** Decimal inflation rate, e.g. 0.025. */
  resolvedInflationRate: number;
  /** Blended % (0–100) implied by the account's custom asset mix, or null when unavailable. */
  assetMixBlendedPct: number | null;
  /** Placeholder for the custom % input. */
  customPlaceholder?: string;
  /** When true, hides the "Asset mix (custom)" option for accounts that are not
   *  already on one (e.g. accounts with no holdings yet). It never hides the
   *  source the account actually stores — see `showAssetMix` below. */
  hideAssetMix?: boolean;
  /** Receives the raw <select> value ("default" | "mp:<id>" | "tp:<id>" | "asset_mix" | "inflation" | "custom"). */
  onSourceChange: (rawSelectValue: string) => void;
  onCustomPctChange: (raw: string) => void;
}

/** Pure mapping from the raw <select> value to (growthSource, modelPortfolioId, tickerPortfolioId). */
export function parseGrowthSourceSelection(
  raw: string,
): { growthSource: GrowthSource; modelPortfolioId: string | null; tickerPortfolioId: string | null } {
  if (raw.startsWith("mp:")) return { growthSource: "model_portfolio", modelPortfolioId: raw.slice(3), tickerPortfolioId: null };
  if (raw.startsWith("tp:")) return { growthSource: "ticker_portfolio", modelPortfolioId: null, tickerPortfolioId: raw.slice(3) };
  if (raw === "asset_mix") return { growthSource: "asset_mix", modelPortfolioId: null, tickerPortfolioId: null };
  if (raw === "inflation") return { growthSource: "inflation", modelPortfolioId: null, tickerPortfolioId: null };
  if (raw === "custom") return { growthSource: "custom", modelPortfolioId: null, tickerPortfolioId: null };
  return { growthSource: "default", modelPortfolioId: null, tickerPortfolioId: null };
}

export function GrowthRateField({
  category,
  growthSource,
  modelPortfolioId,
  growthRatePct,
  modelPortfolios,
  tickerPortfolioId = "",
  fundPortfolios,
  defaultPctForCategory,
  catDefaultPortfolioName,
  resolvedInflationRate,
  assetMixBlendedPct,
  customPlaceholder,
  hideAssetMix = false,
  onSourceChange,
  onCustomPctChange,
}: GrowthRateFieldProps) {
  // A <select> whose value matches no <option> shows the FIRST one, so a
  // dropdown that hides the source the account is actually on displays "Plan
  // default" while the engine goes on using the mix — and the next save writes
  // that lie back. `syncAccountFromHoldings` stamps "asset_mix" on ANY
  // holdings-backed account, whatever its category, so cash / annuity / 529 /
  // real-estate rows do reach this field already on one. Offer the stored
  // source unconditionally; `hideAssetMix` and the category list only govern
  // whether it can be picked ANEW.
  const showAssetMix =
    growthSource === "asset_mix" || (ASSET_MIX_CATEGORIES.includes(category) && !hideAssetMix);
  const selectId = useId();
  const options: GrowthChoice[] = [
    {
      value: "default",
      name: catDefaultPortfolioName ? `Plan default · ${catDefaultPortfolioName}` : "Plan default",
      pct: defaultPctForCategory,
    },
    ...(modelPortfolios ?? []).map((mp) => ({ value: `mp:${mp.id}`, name: mp.name, pct: mp.blendedReturn * 100 })),
    // The same "never hide the stored source" rule the asset-mix comment
    // above states. Fund portfolios are no longer offered as a NEW choice,
    // but the DB enum still accepts `ticker_portfolio` and an API, import
    // or Forge write can land there — and a select whose value matches no
    // option silently displays "Plan default" and saves that lie back.
    ...(growthSource === "ticker_portfolio"
      ? [{
          value: `tp:${tickerPortfolioId}`,
          name: `${fundPortfolios?.find((fp) => fp.id === tickerPortfolioId)?.name ?? "Fund portfolio"} (legacy — re-pick to change)`,
          pct: null,
        }]
      : []),
    ...(showAssetMix ? [{ value: "asset_mix", name: "Asset mix (custom)", pct: assetMixBlendedPct }] : []),
    ...(INFLATION_CATEGORIES.includes(category)
      ? [{ value: "inflation", name: "Inflation rate", pct: resolvedInflationRate * 100 }]
      : []),
    { value: "custom", name: "Custom %", pct: null },
  ];
  return (
    <div>
      <label className={fieldLabelClassName} htmlFor={selectId}>Growth Rate</label>
      <GrowthSourceSelect
        id={selectId}
        value={
          growthSource === "model_portfolio" ? `mp:${modelPortfolioId}`
          : growthSource === "ticker_portfolio" ? `tp:${tickerPortfolioId}`
          : growthSource
        }
        options={options}
        onChange={onSourceChange}
        customInput={
          <PercentInput
            id="growthRate"
            name="growthRate"
            aria-label="Custom growth rate"
            value={growthRatePct}
            onChange={onCustomPctChange}
            placeholder={customPlaceholder ?? "7"}
          />
        }
      />
    </div>
  );
}
