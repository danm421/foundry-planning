"use client";

import { useMemo, useState } from "react";
import type { ProjectionYear } from "@/engine";
import { buildTaxBracketRows } from "@/lib/reports/tax-bracket";
import type { BracketColumnKey } from "@/lib/reports/tax-cell-drill/types";
import type { StateIncomeTaxResult } from "@/lib/tax/state-income";
import { USPS_STATE_NAMES } from "@/lib/usps-states";

interface TaxBracketTabProps {
  years: ProjectionYear[];
  onCellClick: (year: number, columnKey: BracketColumnKey) => void;
}

type Mode = "federal" | "state";

function fmtUsd(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.round(n));
  return `${sign}$${abs.toLocaleString("en-US")}`;
}

function fmtAges(client: number, spouse: number | null): string {
  return spouse == null ? `${client}` : `${client}/${spouse}`;
}

function fmtRate(rate: number): string {
  // 0.0525 -> "5.25%". Use 2 decimals for state (often non-integer); strip
  // trailing zeros so 5% reads as "5%".
  const pct = rate * 100;
  const fixed = pct.toFixed(2).replace(/\.?0+$/, "");
  return `${fixed}%`;
}

function ClickableCell({
  onClick,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="block w-full cursor-pointer text-right hover:text-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
    >
      {children}
    </button>
  );
}

// ---------------- State-mode row helpers ----------------

interface StateBracketRow {
  year: number;
  clientAge: number;
  spouseAge: number | null;
  stateCode: string | null;
  stateTaxableIncome: number;
  marginalRate: number;
  intoBracket: number;
  remainingInBracket: number | null;
  stateTax: number;
  changeInBase: number;
}

function pickMarginalTier(
  taxableIncome: number,
  brackets: StateIncomeTaxResult["bracketsUsed"],
): { from: number; to: number | null; rate: number } | null {
  if (brackets.length === 0) return null;
  for (const tier of brackets) {
    const lowerOk = taxableIncome >= tier.from;
    const upperOk = tier.to == null || taxableIncome < tier.to;
    if (lowerOk && upperOk) return tier;
  }
  // Above all tiers — pin to top tier.
  return brackets[brackets.length - 1];
}

function buildStateBracketRows(years: ProjectionYear[]): StateBracketRow[] {
  const rows: StateBracketRow[] = [];
  let prevBase: number | null = null;

  for (const year of years) {
    const state = year.taxResult?.state;
    if (!state) continue;

    const base = state.stateTaxableIncome;
    const tier = pickMarginalTier(base, state.bracketsUsed);
    const intoBracket = tier ? Math.max(0, base - tier.from) : 0;
    const remainingInBracket =
      tier && tier.to != null ? Math.max(0, tier.to - base) : null;
    const changeInBase = prevBase == null ? 0 : base - prevBase;

    rows.push({
      year: year.year,
      clientAge: year.ages.client,
      spouseAge: year.ages.spouse ?? null,
      stateCode: state.state,
      stateTaxableIncome: base,
      marginalRate: tier?.rate ?? 0,
      intoBracket,
      remainingInBracket,
      stateTax: state.stateTax,
      changeInBase,
    });

    prevBase = base;
  }

  return rows;
}

// ---------------- Federal table (extracted) ----------------

function FederalTable({
  years,
  onCellClick,
}: {
  years: ProjectionYear[];
  onCellClick: (year: number, columnKey: BracketColumnKey) => void;
}) {
  const rows = useMemo(() => buildTaxBracketRows(years), [years]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-amber-200/70">
            <th className="px-3 py-3 text-left font-normal">
              <span className="border-b border-dotted border-amber-200/40 pb-px">Year</span>
            </th>
            <th className="px-3 py-3 text-left font-normal">
              <span className="border-b border-dotted border-amber-200/40 pb-px">Age</span>
            </th>
            <th className="border-l border-amber-200/30 px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-amber-200/40 pb-px">Roth Conversion</span>
            </th>
            <th className="px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-amber-200/40 pb-px">Taxable Portion of Roth Conversion</span>
            </th>
            <th className="px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-amber-200/40 pb-px">Income Tax Base</span>
            </th>
            <th className="px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-amber-200/40 pb-px">Federal Marginal Bracket</span>
            </th>
            <th className="px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-amber-200/40 pb-px">Amount into Federal Marginal Bracket</span>
            </th>
            <th className="px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-amber-200/40 pb-px">Remaining in Federal Marginal Bracket</span>
            </th>
            <th className="px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-amber-200/40 pb-px">Change in Income Tax Base</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.year} className="border-t border-amber-200/10 hover:[&>td]:shadow-[inset_0_1px_0_#fff,inset_0_-1px_0_#fff]">
              <td className="px-3 py-3">{r.year}</td>
              <td className="px-3 py-3">{fmtAges(r.clientAge, r.spouseAge)}</td>
              <td className="border-l border-amber-200/30 px-3 py-3 text-right">
                <ClickableCell
                  onClick={() => onCellClick(r.year, "conversionGross")}
                  ariaLabel={`Roth conversion ${r.year} value ${fmtUsd(r.conversionGross)}`}
                >
                  {fmtUsd(r.conversionGross)}
                </ClickableCell>
              </td>
              <td className="px-3 py-3 text-right">
                <ClickableCell
                  onClick={() => onCellClick(r.year, "conversionTaxable")}
                  ariaLabel={`Taxable portion ${r.year} value ${fmtUsd(r.conversionTaxable)}`}
                >
                  {fmtUsd(r.conversionTaxable)}
                </ClickableCell>
              </td>
              <td className="px-3 py-3 text-right">{fmtUsd(r.incomeTaxBase)}</td>
              <td className="px-3 py-3 text-right">{Math.round(r.marginalRate * 100)}%</td>
              <td className="px-3 py-3 text-right">
                <ClickableCell
                  onClick={() => onCellClick(r.year, "intoBracket")}
                  ariaLabel={`Amount into bracket ${r.year} value ${fmtUsd(r.intoBracket)}`}
                >
                  {fmtUsd(r.intoBracket)}
                </ClickableCell>
              </td>
              <td className="px-3 py-3 text-right">
                {r.remainingInBracket == null ? "—" : fmtUsd(r.remainingInBracket)}
              </td>
              <td
                className={`px-3 py-3 text-right ${r.changeInBase < 0 ? "text-red-400" : ""}`}
              >
                {fmtUsd(r.changeInBase)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="px-3 py-10 text-center text-amber-200/50">
          No projection years to show.
        </div>
      )}
    </div>
  );
}

// ---------------- State table ----------------

function StateTable({ years }: { years: ProjectionYear[] }) {
  const rows = useMemo(() => buildStateBracketRows(years), [years]);
  const noIncomeTaxEverywhere = useMemo(
    () =>
      years.length > 0 &&
      years.every((y) => y.taxResult?.state && !y.taxResult.state.hasIncomeTax),
    [years],
  );

  // Resolve a display label for the state(s) in play. Most plans are
  // single-state, but tolerate variation across years (e.g. residence change).
  const stateLabel = useMemo(() => {
    const codes = new Set<string>();
    for (const r of rows) if (r.stateCode) codes.add(r.stateCode);
    if (codes.size === 0) return null;
    if (codes.size === 1) {
      const code = [...codes][0];
      const name = USPS_STATE_NAMES[code as keyof typeof USPS_STATE_NAMES];
      return name ? `${name} (${code})` : code;
    }
    return [...codes].join(" / ");
  }, [rows]);

  if (noIncomeTaxEverywhere) {
    return (
      <div className="rounded-md border border-amber-900/40 bg-amber-950/30 px-4 py-5 text-sm text-amber-200/80">
        {stateLabel
          ? `${stateLabel} does not levy a personal income tax — no state-bracket detail to display.`
          : "Residence state does not levy a personal income tax — no state-bracket detail to display."}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="px-3 py-10 text-center text-amber-200/50">
        No projection years to show.
      </div>
    );
  }

  // If every row has empty brackets (e.g. flat-rate fallback with no residence
  // state, or a no-bracket compute path), surface a placeholder instead of an
  // empty-looking table.
  const allFlatOrEmpty = rows.every((r) => r.marginalRate === 0 && r.intoBracket === 0);
  if (allFlatOrEmpty) {
    return (
      <div className="rounded-md border border-amber-900/40 bg-amber-950/30 px-4 py-5 text-sm text-amber-200/80">
        No state-tax bracket data — flat rate or no income tax.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      {stateLabel && (
        <div className="mb-3 text-xs text-amber-200/70">
          Residence state: <span className="text-amber-100">{stateLabel}</span>
        </div>
      )}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-amber-200/70">
            <th className="px-3 py-3 text-left font-normal">
              <span className="border-b border-dotted border-amber-200/40 pb-px">Year</span>
            </th>
            <th className="px-3 py-3 text-left font-normal">
              <span className="border-b border-dotted border-amber-200/40 pb-px">Age</span>
            </th>
            <th className="border-l border-amber-200/30 px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-amber-200/40 pb-px">State Taxable Income</span>
            </th>
            <th className="px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-amber-200/40 pb-px">State Marginal Bracket</span>
            </th>
            <th className="px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-amber-200/40 pb-px">Amount into State Marginal Bracket</span>
            </th>
            <th className="px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-amber-200/40 pb-px">Remaining in State Marginal Bracket</span>
            </th>
            <th className="px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-amber-200/40 pb-px">State Tax</span>
            </th>
            <th className="px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-amber-200/40 pb-px">Change in State Taxable Income</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.year} className="border-t border-amber-200/10 hover:[&>td]:shadow-[inset_0_1px_0_#fff,inset_0_-1px_0_#fff]">
              <td className="px-3 py-3">{r.year}</td>
              <td className="px-3 py-3">{fmtAges(r.clientAge, r.spouseAge)}</td>
              <td className="border-l border-amber-200/30 px-3 py-3 text-right">
                {fmtUsd(r.stateTaxableIncome)}
              </td>
              <td className="px-3 py-3 text-right">{fmtRate(r.marginalRate)}</td>
              <td className="px-3 py-3 text-right">{fmtUsd(r.intoBracket)}</td>
              <td className="px-3 py-3 text-right">
                {r.remainingInBracket == null ? "—" : fmtUsd(r.remainingInBracket)}
              </td>
              <td className="px-3 py-3 text-right">{fmtUsd(r.stateTax)}</td>
              <td
                className={`px-3 py-3 text-right ${r.changeInBase < 0 ? "text-red-400" : ""}`}
              >
                {fmtUsd(r.changeInBase)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- Top-level ----------------

function ModeButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
        active
          ? "bg-amber-200 text-stone-950"
          : "bg-transparent text-amber-200/70 hover:text-amber-100"
      }`}
    >
      {label}
    </button>
  );
}

export function TaxBracketTab({ years, onCellClick }: TaxBracketTabProps) {
  const [mode, setMode] = useState<Mode>("federal");

  return (
    <div className="rounded-md bg-stone-950 p-5 text-amber-100">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold tracking-tight">Tax Bracket</h3>
          <span className="rounded-md border border-amber-900/40 bg-amber-950/40 px-2.5 py-1 text-xs text-amber-200/80">
            All Years
          </span>
          <div
            role="group"
            aria-label="Bracket scope"
            className="inline-flex overflow-hidden rounded-md border border-amber-900/40"
          >
            <ModeButton label="Federal" active={mode === "federal"} onClick={() => setMode("federal")} />
            <span aria-hidden className="w-px bg-amber-900/40" />
            <ModeButton label="State" active={mode === "state"} onClick={() => setMode("state")} />
          </div>
        </div>
        <div className="flex items-center gap-5 text-xs text-amber-200/70">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-3 w-3 rounded-sm border border-amber-200/60" />
            Multiple Events
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0 w-0 border-x-[6px] border-b-[10px] border-x-transparent border-b-amber-200/60" />
            End Of Life
          </span>
        </div>
      </div>

      {mode === "federal" ? (
        <FederalTable years={years} onCellClick={onCellClick} />
      ) : (
        <StateTable years={years} />
      )}
    </div>
  );
}
