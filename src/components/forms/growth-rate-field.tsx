"use client";

import { PercentInput } from "@/components/percent-input";
import { fieldLabelClassName, selectClassName, inputClassName } from "./input-styles";
import type { GrowthSource } from "@/lib/investments/allocation";

const ASSET_MIX_CATEGORIES = ["taxable", "retirement"];
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
  /** Receives the raw <select> value ("default" | "mp:<id>" | "asset_mix" | "inflation" | "custom"). */
  onSourceChange: (rawSelectValue: string) => void;
  onCustomPctChange: (raw: string) => void;
}

/** Pure mapping from the raw <select> value to (growthSource, modelPortfolioId). */
export function parseGrowthSourceSelection(
  raw: string,
): { growthSource: GrowthSource; modelPortfolioId: string | null } {
  if (raw.startsWith("mp:")) return { growthSource: "model_portfolio", modelPortfolioId: raw.slice(3) };
  if (raw === "asset_mix") return { growthSource: "asset_mix", modelPortfolioId: null };
  if (raw === "inflation") return { growthSource: "inflation", modelPortfolioId: null };
  if (raw === "custom") return { growthSource: "custom", modelPortfolioId: null };
  return { growthSource: "default", modelPortfolioId: null };
}

export function GrowthRateField({
  category,
  growthSource,
  modelPortfolioId,
  growthRatePct,
  modelPortfolios,
  defaultPctForCategory,
  catDefaultPortfolioName,
  resolvedInflationRate,
  assetMixBlendedPct,
  customPlaceholder,
  onSourceChange,
  onCustomPctChange,
}: GrowthRateFieldProps) {
  return (
    <div>
      <label className={fieldLabelClassName}>Growth Rate</label>
      <select
        value={growthSource === "model_portfolio" ? `mp:${modelPortfolioId}` : growthSource}
        onChange={(e) => onSourceChange(e.target.value)}
        className={selectClassName}
      >
        <option value="default">
          {defaultPctForCategory !== null ? `${defaultPctForCategory}% — ` : ""}
          {catDefaultPortfolioName ?? "Category default"} (default)
        </option>
        {modelPortfolios?.map((mp) => (
          <option key={mp.id} value={`mp:${mp.id}`}>
            {(mp.blendedReturn * 100).toFixed(2)}% — {mp.name}
          </option>
        ))}
        {ASSET_MIX_CATEGORIES.includes(category) && (
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
            onChange={(raw) => onCustomPctChange(raw)}
            placeholder={customPlaceholder ?? "7"}
            className={inputClassName}
          />
        </div>
      )}
    </div>
  );
}
