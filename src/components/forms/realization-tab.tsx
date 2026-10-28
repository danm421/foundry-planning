"use client";

import { PercentInput } from "@/components/percent-input";
import type { RealizationMix } from "@/lib/investments/realization-mix";
import { FieldTooltip } from "./field-tooltip";
import { fieldLabelBaseClassName } from "./input-styles";

export type RealizationOverrides = Record<keyof RealizationMix, string>;

// `name` is the form field the submit path reads (FormData), so it must match
// the account body's column names.
const ROWS: { key: keyof RealizationMix; name: string; label: string }[] = [
  { key: "pctOrdinaryIncome", name: "overridePctOi", label: "Ordinary income" },
  { key: "pctQualifiedDividends", name: "overridePctQdiv", label: "Qualified dividends" },
  { key: "pctLtCapitalGains", name: "overridePctLtCg", label: "Long-term capital gains" },
  { key: "pctTaxExempt", name: "overridePctTaxExempt", label: "Tax-exempt" },
];

const pct = (fraction: number) => (fraction * 100).toFixed(2);

interface RealizationTabProps {
  /** What the account's growth source realizes before any override, and what
   *  to call that source (a flat rate realizes all long-term gains). Null when
   *  the screen lacks the portfolio data to tell: the boxes still edit, with no
   *  default beside them. */
  source: { label: string; mix: RealizationMix } | null;
  /** Percent strings per row; "" follows the source. */
  overrides: RealizationOverrides;
  onOverrideChange: (key: keyof RealizationMix, raw: string) => void;
  turnoverPct: string;
  onTurnoverChange: (raw: string) => void;
}

export function RealizationTab({
  source,
  overrides,
  onOverrideChange,
  turnoverPct,
  onTurnoverChange,
}: RealizationTabProps) {
  const anyOverride = ROWS.some((r) => overrides[r.key] !== "");
  const mix = source?.mix;
  const sourceTotal = mix ? ROWS.reduce((sum, r) => sum + mix[r.key], 0) : 0;
  const accountTotal = mix
    ? ROWS.reduce((sum, r) => sum + (overrides[r.key] !== "" ? Number(overrides[r.key]) / 100 : mix[r.key]), 0)
    : 0;
  const totalOff = mix != null && anyOverride && Math.abs(accountTotal - 1) > 0.00005;
  const headClassName = "text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3";

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-ink-2">
        Blank boxes follow{" "}
        <span className="font-medium text-ink">{source?.label ?? "this account's growth setting"}</span>.
        Enter a figure to override it for this account.
      </p>

      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_7.5rem_3rem] items-center gap-x-3 gap-y-2">
        <span className={`flex items-center gap-1.5 ${headClassName}`}>
          Share of growth
          <FieldTooltip
            side="bottom"
            text="How each year's growth is taxed. Ordinary income and qualified dividends are taxed as they're earned; long-term gains wait until the shares are sold."
          />
        </span>
        <span className={`text-right ${headClassName}`}>Default</span>
        <span className={headClassName}>This account</span>
        <span />

        {ROWS.map((r) => {
          const overridden = overrides[r.key] !== "";
          return (
            <div key={r.key} className="contents">
              <label htmlFor={`realization-${r.key}`} className={fieldLabelBaseClassName}>
                {r.label}
              </label>
              <span className="tabular text-right text-[13px] text-ink-2">{mix ? `${pct(mix[r.key])}%` : "—"}</span>
              <PercentInput
                id={`realization-${r.key}`}
                name={r.name}
                compact
                value={overrides[r.key]}
                onChange={(raw) => onOverrideChange(r.key, raw)}
                placeholder={mix ? pct(mix[r.key]) : undefined}
                className="tabular"
              />
              {overridden ? (
                <button
                  type="button"
                  onClick={() => onOverrideChange(r.key, "")}
                  aria-label={`Reset ${r.label.toLowerCase()} to the default figure`}
                  className="text-xs text-ink-3 hover:text-ink focus:text-ink focus:outline-none"
                >
                  Reset
                </button>
              ) : (
                <span />
              )}
            </div>
          );
        })}

        {mix && (
          <>
            <div className="col-span-4 border-t border-hair" />
            <span className={fieldLabelBaseClassName}>Total</span>
            <span className="tabular text-right text-[13px] text-ink-2">{pct(sourceTotal)}%</span>
            <span className={`tabular pl-3 text-[13px] ${totalOff ? "text-warn" : "text-ink-2"}`}>
              {pct(accountTotal)}%
            </span>
            <span />
          </>
        )}
      </div>

      {totalOff && (
        <p className="text-xs text-warn">These add to {pct(accountTotal)}%. They should total 100%.</p>
      )}

      <div className="max-w-[12rem]">
        <label htmlFor="realization-turnover" className={`mb-1.5 flex items-center gap-1.5 ${fieldLabelBaseClassName}`}>
          Turnover
          <FieldTooltip text="The share of long-term gains realized as short-term gains each year, from trading inside the account." />
        </label>
        <PercentInput
          id="realization-turnover"
          name="turnoverPct"
          value={turnoverPct}
          onChange={onTurnoverChange}
        />
      </div>
    </div>
  );
}
