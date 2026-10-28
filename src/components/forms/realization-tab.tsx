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
   *  to call that source. Null when the account grows at a flat rate (custom
   *  or inflation): the projection realizes nothing from that growth yearly,
   *  so overrides and turnover have nothing to apply to. */
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
  if (!source) {
    return (
      <>
        <p className="text-[13px] text-ink-2">
          This account grows at a flat rate, so its growth is taxed only when it is sold. To
          model yearly income and dividends, choose a portfolio or asset mix for its growth on
          the Account Details tab.
        </p>
        {/* Keep stored settings through a save — they apply again once a
            portfolio drives the account. */}
        {ROWS.map((r) => (
          <input key={r.name} type="hidden" name={r.name} value={overrides[r.key]} />
        ))}
        <input type="hidden" name="turnoverPct" value={turnoverPct} />
      </>
    );
  }

  const anyOverride = ROWS.some((r) => overrides[r.key] !== "");
  const sourceTotal = ROWS.reduce((sum, r) => sum + source.mix[r.key], 0);
  const accountTotal = ROWS.reduce(
    (sum, r) => sum + (overrides[r.key] !== "" ? Number(overrides[r.key]) / 100 : source.mix[r.key]),
    0,
  );
  const totalOff = anyOverride && Math.abs(accountTotal - 1) > 0.00005;
  const headClassName = "text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3";

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-ink-2">
        Blank boxes follow <span className="font-medium text-ink">{source.label}</span>. Enter a
        figure to override it for this account.
      </p>

      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_7.5rem_3rem] items-center gap-x-3 gap-y-2">
        <span className={`flex items-center gap-1.5 ${headClassName}`}>
          Share of growth
          <FieldTooltip
            side="bottom"
            text="How each year's growth is taxed. Ordinary income and qualified dividends are taxed as they're earned; long-term gains wait until the shares are sold."
          />
        </span>
        <span className={`text-right ${headClassName}`}>Portfolio</span>
        <span className={headClassName}>This account</span>
        <span />

        {ROWS.map((r) => {
          const overridden = overrides[r.key] !== "";
          return (
            <div key={r.key} className="contents">
              <label htmlFor={`realization-${r.key}`} className={fieldLabelBaseClassName}>
                {r.label}
              </label>
              <span className="tabular text-right text-[13px] text-ink-2">{pct(source.mix[r.key])}%</span>
              <PercentInput
                id={`realization-${r.key}`}
                name={r.name}
                compact
                value={overrides[r.key]}
                onChange={(raw) => onOverrideChange(r.key, raw)}
                placeholder={pct(source.mix[r.key])}
                className="tabular"
              />
              {overridden ? (
                <button
                  type="button"
                  onClick={() => onOverrideChange(r.key, "")}
                  aria-label={`Reset ${r.label.toLowerCase()} to the portfolio's figure`}
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

        <div className="col-span-4 border-t border-hair" />
        <span className={fieldLabelBaseClassName}>Total</span>
        <span className="tabular text-right text-[13px] text-ink-2">{pct(sourceTotal)}%</span>
        <span className={`tabular pl-3 text-[13px] ${totalOff ? "text-warn" : "text-ink-2"}`}>
          {pct(accountTotal)}%
        </span>
        <span />
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
