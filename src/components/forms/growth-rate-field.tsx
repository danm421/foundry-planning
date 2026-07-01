"use client";

import { PercentInput } from "@/components/percent-input";
import { fieldLabelClassName, selectClassName, inputClassName } from "./input-styles";
import type { GrowthSource } from "@/lib/investments/allocation";

/** Categories whose growth can be driven by a custom asset mix (and that show the asset-mix tab). */
export const ASSET_MIX_CATEGORIES = ["taxable", "retirement"];
const INFLATION_CATEGORIES = ["cash", "taxable", "retirement"];

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
  /** When true, hides the "Asset mix (custom)" option (e.g. for accounts with no holdings yet). */
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
  return (
    <div>
      <label className={fieldLabelClassName}>Growth Rate</label>
      <select
        value={
          growthSource === "model_portfolio" ? `mp:${modelPortfolioId}`
          : growthSource === "ticker_portfolio" ? `tp:${tickerPortfolioId}`
          : growthSource
        }
        onChange={(e) => onSourceChange(e.target.value)}
        className={selectClassName}
      >
        <option value="default">
          Plan default
          {defaultPctForCategory !== null ? ` — ${defaultPctForCategory}%` : ""}
          {catDefaultPortfolioName ? ` ${catDefaultPortfolioName}` : " (category default)"}
        </option>
        {modelPortfolios?.map((mp) => (
          <option key={mp.id} value={`mp:${mp.id}`}>
            {(mp.blendedReturn * 100).toFixed(2)}% — {mp.name}
          </option>
        ))}
        {fundPortfolios && fundPortfolios.length > 0 && (
          <optgroup label="Fund portfolios">
            {fundPortfolios.map((fp) => (
              <option key={fp.id} value={`tp:${fp.id}`} disabled={fp.blendedReturnPct === null}>
                {fp.blendedReturnPct !== null ? `${fp.blendedReturnPct.toFixed(2)}% — ` : ""}
                {fp.name}{fp.blendedReturnPct === null ? " (needs classified holdings)" : ""}
              </option>
            ))}
          </optgroup>
        )}
        {ASSET_MIX_CATEGORIES.includes(category) && !hideAssetMix && (
          <option value="asset_mix">
            {assetMixBlendedPct !== null ? `${assetMixBlendedPct.toFixed(2)}% — ` : ""}Asset mix (custom)
          </option>
        )}
        {INFLATION_CATEGORIES.includes(category) && (
          <option value="inflation">
            {(resolvedInflationRate * 100).toFixed(2)}% — Inflation rate
          </option>
        )}
        <option value="custom">Custom %</option>
      </select>
      {growthSource === "inflation" && (
        <p className="mt-1 text-xs text-gray-400">
          Growth tracks plan inflation rate: {(resolvedInflationRate * 100).toFixed(2)}%
        </p>
      )}
      {growthSource === "custom" && (
        <div className="mt-2">
          <PercentInput
            id="growthRate"
            name="growthRate"
            value={growthRatePct}
            onChange={onCustomPctChange}
            placeholder={customPlaceholder ?? "7"}
            className={inputClassName}
          />
        </div>
      )}
    </div>
  );
}
