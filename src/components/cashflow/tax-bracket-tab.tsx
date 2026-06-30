"use client";

import { useMemo, useState } from "react";
import type { ProjectionYear } from "@/engine";
import { buildTaxBracketRows, buildStateBracketRows, type StateBracketRow } from "@/lib/tax/bracket";
import type { BracketColumnKey } from "@/lib/tax/cell-drill/types";
import { USPS_STATE_NAMES } from "@/lib/usps-states";

interface TaxBracketTabProps {
  years: ProjectionYear[];
  onCellClick?: (year: number, columnKey: BracketColumnKey) => void;
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
      className="block w-full cursor-pointer text-right hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
    </button>
  );
}

// Renders a clickable drill cell when an onClick is supplied (cash-flow view),
// or plain right-aligned text when it isn't (Solver, which has no cell-drill).
function MaybeCell({
  onClick,
  ariaLabel,
  children,
}: {
  onClick?: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  if (!onClick) return <span className="block text-right">{children}</span>;
  return (
    <ClickableCell onClick={onClick} ariaLabel={ariaLabel}>
      {children}
    </ClickableCell>
  );
}

// ---------------- Federal table (extracted) ----------------

function FederalTable({
  years,
  onCellClick,
}: {
  years: ProjectionYear[];
  onCellClick?: (year: number, columnKey: BracketColumnKey) => void;
}) {
  const rows = useMemo(() => buildTaxBracketRows(years), [years]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-ink-3">
            <th className="px-3 py-3 text-left font-normal">
              <span className="border-b border-dotted border-hair pb-px">Year</span>
            </th>
            <th className="px-3 py-3 text-left font-normal">
              <span className="border-b border-dotted border-hair pb-px">Age</span>
            </th>
            <th className="border-l border-hair px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-hair pb-px">Roth Conversion</span>
            </th>
            <th className="px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-hair pb-px">Taxable Portion of Roth Conversion</span>
            </th>
            <th className="px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-hair pb-px">Income Tax Base</span>
            </th>
            <th className="px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-hair pb-px">Federal Marginal Bracket</span>
            </th>
            <th className="px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-hair pb-px">Amount into Federal Marginal Bracket</span>
            </th>
            <th className="px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-hair pb-px">Remaining in Federal Marginal Bracket</span>
            </th>
            <th className="px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-hair pb-px">Change in Income Tax Base</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.year} className="border-t border-hair hover:[&>td]:shadow-[inset_0_1px_0_var(--color-ink),inset_0_-1px_0_var(--color-ink)]">
              <td className="px-3 py-3">{r.year}</td>
              <td className="px-3 py-3">{fmtAges(r.clientAge, r.spouseAge)}</td>
              <td className="border-l border-hair px-3 py-3 text-right">
                <MaybeCell
                  onClick={onCellClick ? () => onCellClick(r.year, "conversionGross") : undefined}
                  ariaLabel={`Roth conversion ${r.year} value ${fmtUsd(r.conversionGross)}`}
                >
                  {fmtUsd(r.conversionGross)}
                </MaybeCell>
              </td>
              <td className="px-3 py-3 text-right">
                <MaybeCell
                  onClick={onCellClick ? () => onCellClick(r.year, "conversionTaxable") : undefined}
                  ariaLabel={`Taxable portion ${r.year} value ${fmtUsd(r.conversionTaxable)}`}
                >
                  {fmtUsd(r.conversionTaxable)}
                </MaybeCell>
              </td>
              <td className="px-3 py-3 text-right">{fmtUsd(r.incomeTaxBase)}</td>
              <td className="px-3 py-3 text-right">{Math.round(r.marginalRate * 100)}%</td>
              <td className="px-3 py-3 text-right">
                <MaybeCell
                  onClick={onCellClick ? () => onCellClick(r.year, "intoBracket") : undefined}
                  ariaLabel={`Amount into bracket ${r.year} value ${fmtUsd(r.intoBracket)}`}
                >
                  {fmtUsd(r.intoBracket)}
                </MaybeCell>
              </td>
              <td className="px-3 py-3 text-right">
                {r.remainingInBracket == null ? "—" : fmtUsd(r.remainingInBracket)}
              </td>
              <td
                className={`px-3 py-3 text-right ${r.changeInBase < 0 ? "text-crit" : ""}`}
              >
                {fmtUsd(r.changeInBase)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="px-3 py-10 text-center text-ink-4">
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
      <div className="rounded-md border border-hair-2 bg-card-2 px-4 py-5 text-sm text-ink-2">
        {stateLabel
          ? `${stateLabel} does not levy a personal income tax — no state-bracket detail to display.`
          : "Residence state does not levy a personal income tax — no state-bracket detail to display."}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="px-3 py-10 text-center text-ink-4">
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
      <div className="rounded-md border border-hair-2 bg-card-2 px-4 py-5 text-sm text-ink-2">
        No state-tax bracket data — flat rate or no income tax.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      {stateLabel && (
        <div className="mb-3 text-xs text-ink-3">
          Residence state: <span className="text-ink">{stateLabel}</span>
        </div>
      )}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-ink-3">
            <th className="px-3 py-3 text-left font-normal">
              <span className="border-b border-dotted border-hair pb-px">Year</span>
            </th>
            <th className="px-3 py-3 text-left font-normal">
              <span className="border-b border-dotted border-hair pb-px">Age</span>
            </th>
            <th className="border-l border-hair px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-hair pb-px">State Taxable Income</span>
            </th>
            <th className="px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-hair pb-px">State Marginal Bracket</span>
            </th>
            <th className="px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-hair pb-px">Amount into State Marginal Bracket</span>
            </th>
            <th className="px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-hair pb-px">Remaining in State Marginal Bracket</span>
            </th>
            <th className="px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-hair pb-px">State Tax</span>
            </th>
            <th className="px-3 py-3 text-right font-normal">
              <span className="border-b border-dotted border-hair pb-px">Change in State Taxable Income</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.year} className="border-t border-hair hover:[&>td]:shadow-[inset_0_1px_0_var(--color-ink),inset_0_-1px_0_var(--color-ink)]">
              <td className="px-3 py-3">{r.year}</td>
              <td className="px-3 py-3">{fmtAges(r.clientAge, r.spouseAge)}</td>
              <td className="border-l border-hair px-3 py-3 text-right">
                {fmtUsd(r.stateTaxableIncome)}
              </td>
              <td className="px-3 py-3 text-right">{fmtRate(r.marginalRate)}</td>
              <td className="px-3 py-3 text-right">{fmtUsd(r.intoBracket)}</td>
              <td className="px-3 py-3 text-right">
                {r.remainingInBracket == null ? "—" : fmtUsd(r.remainingInBracket)}
              </td>
              <td className="px-3 py-3 text-right">{fmtUsd(r.stateTax)}</td>
              <td
                className={`px-3 py-3 text-right ${r.changeInBase < 0 ? "text-crit" : ""}`}
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
      className={`px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        active
          ? "bg-accent text-accent-ink"
          : "bg-transparent text-ink-3 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

export function TaxBracketTab({ years, onCellClick }: TaxBracketTabProps) {
  const [mode, setMode] = useState<Mode>("federal");

  return (
    <div className="rounded-md bg-paper p-5 text-ink">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold tracking-tight">Tax Bracket</h3>
          <span className="rounded-md border border-hair-2 bg-card-2 px-2.5 py-1 text-xs text-ink-2">
            All Years
          </span>
          <div
            role="group"
            aria-label="Bracket scope"
            className="inline-flex overflow-hidden rounded-md border border-hair-2"
          >
            <ModeButton label="Federal" active={mode === "federal"} onClick={() => setMode("federal")} />
            <span aria-hidden className="w-px bg-hair" />
            <ModeButton label="State" active={mode === "state"} onClick={() => setMode("state")} />
          </div>
        </div>
        <div className="flex items-center gap-5 text-xs text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-3 w-3 rounded-sm border border-hair-2" />
            Multiple Events
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0 w-0 border-x-[6px] border-b-[10px] border-x-transparent border-b-hair-2" />
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
