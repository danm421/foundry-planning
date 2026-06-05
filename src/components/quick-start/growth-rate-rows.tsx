// src/components/quick-start/growth-rate-rows.tsx
"use client";
import { inputClassName } from "@/components/forms/input-styles";
import type { ModelPortfolioOption } from "@/lib/cma/model-portfolio-options";
import type { GrowthCategorySource, FlatGrowthSource } from "@/lib/quick-start/types";

export interface InvestableRow {
  source: GrowthCategorySource;
  portfolioId: string | null;
  /** Percent string (e.g. "7"); used only when source === "custom". */
  customDisplay: string;
}
export interface FlatRow {
  source: FlatGrowthSource;
  customDisplay: string;
}

const INVESTABLE = [
  { key: "taxable", label: "Taxable" },
  { key: "cash", label: "Cash" },
  { key: "retirement", label: "Retirement" },
] as const;
const FLAT = [
  { key: "realEstate", label: "Real estate" },
  { key: "lifeInsurance", label: "Life insurance" },
] as const;

export type InvestableKey = (typeof INVESTABLE)[number]["key"];
export type FlatKey = (typeof FLAT)[number]["key"];

const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_7rem] items-center gap-3";

interface GrowthRateRowsProps {
  modelPortfolios: ModelPortfolioOption[];
  /** Current inflation, as a percent number (e.g. 3), for the "Inflation (X%)" labels. */
  inflationPct: number;
  investable: Record<InvestableKey, InvestableRow>;
  flat: Record<FlatKey, FlatRow>;
  onInvestableChange: (key: InvestableKey, next: InvestableRow) => void;
  onFlatChange: (key: FlatKey, next: FlatRow) => void;
}

export function GrowthRateRows({
  modelPortfolios,
  inflationPct,
  investable,
  flat,
  onInvestableChange,
  onFlatChange,
}: GrowthRateRowsProps) {
  const inflationLabel = `Inflation (${inflationPct.toFixed(2)}%)`;

  return (
    <div>
      <div className="mb-2 text-[12px] font-medium text-ink-3">Growth rates</div>
      <div className="space-y-2">
        <div className={`${ROW_GRID} text-[11px] font-medium uppercase tracking-wide text-ink-3`}>
          <span>Category</span>
          <span>Source</span>
          <span className="text-right">Rate</span>
        </div>

        {/* Investable categories — model portfolio / inflation / custom */}
        {INVESTABLE.map(({ key, label }) => {
          const row = investable[key];
          const selectVal = row.source === "model_portfolio" ? `mp:${row.portfolioId}` : row.source;
          return (
            <div key={key} className={ROW_GRID}>
              <span className="truncate text-[14px] font-medium text-ink">{label}</span>
              <select
                aria-label={`${label} growth source`}
                value={selectVal}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.startsWith("mp:")) {
                    onInvestableChange(key, { ...row, source: "model_portfolio", portfolioId: v.slice(3) });
                  } else if (v === "inflation") {
                    onInvestableChange(key, { ...row, source: "inflation", portfolioId: null });
                  } else {
                    onInvestableChange(key, { ...row, source: "custom", portfolioId: null });
                  }
                }}
                className={inputClassName}
              >
                {modelPortfolios.map((mp) => (
                  <option key={mp.id} value={`mp:${mp.id}`}>
                    {mp.name} ({(mp.blendedReturn * 100).toFixed(2)}%)
                  </option>
                ))}
                <option value="inflation">{inflationLabel}</option>
                <option value="custom">Custom %</option>
              </select>
              <div className="justify-self-end">
                {row.source === "custom" ? (
                  <input
                    type="number"
                    aria-label={`${label} growth rate`}
                    value={row.customDisplay}
                    onChange={(e) => onInvestableChange(key, { ...row, customDisplay: e.target.value })}
                    className={`${inputClassName} w-[7rem] text-right`}
                  />
                ) : (
                  <span className="block w-[7rem] text-right text-[12px] text-ink-3">—</span>
                )}
              </div>
            </div>
          );
        })}

        {/* Non-investable categories — inflation / custom */}
        {FLAT.map(({ key, label }) => {
          const row = flat[key];
          return (
            <div key={key} className={ROW_GRID}>
              <span className="truncate text-[14px] font-medium text-ink">{label}</span>
              <select
                aria-label={`${label} growth source`}
                value={row.source}
                onChange={(e) =>
                  onFlatChange(key, { ...row, source: e.target.value as FlatGrowthSource })
                }
                className={inputClassName}
              >
                <option value="inflation">{inflationLabel}</option>
                <option value="custom">Custom %</option>
              </select>
              <div className="justify-self-end">
                {row.source === "custom" ? (
                  <input
                    type="number"
                    aria-label={`${label} growth rate`}
                    value={row.customDisplay}
                    onChange={(e) => onFlatChange(key, { ...row, customDisplay: e.target.value })}
                    className={`${inputClassName} w-[7rem] text-right`}
                  />
                ) : (
                  <span className="block w-[7rem] text-right text-[12px] text-ink-3">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
