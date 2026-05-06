"use client";

import { useState, type CSSProperties } from "react";
import type {
  YearlyEstateRow,
  YearlyEstateDeathRow,
} from "@/lib/estate/yearly-estate-report";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

interface YearlyEstateTableProps {
  rows: YearlyEstateRow[];
  totals: {
    taxesAndExpenses: number;
    netToHeirs: number;
    charityAssets: number;
    heirsAssets: number;
    totalToHeirs: number;
    totalToHeirsAndCharity: number;
  };
  ownerNames: { clientName: string; spouseName: string | null };
  /** Indicate the active hypothetical death-ordering for the table caption. */
  ordering: "primaryFirst" | "spouseFirst";
}

export function YearlyEstateTable({
  rows,
  totals,
  ownerNames,
  ordering,
}: YearlyEstateTableProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggleYear = (year: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-300">
        No yearly estate data available.
      </div>
    );
  }

  const orderingLabel =
    ordering === "primaryFirst"
      ? `${ownerNames.clientName} dies first`
      : `${ownerNames.spouseName ?? "Spouse"} dies first`;

  return (
    <section className="overflow-hidden rounded-xl border border-indigo-900/50 bg-indigo-950/15">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-indigo-900/40 px-5 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-indigo-300/80">
            Hypothetical · {orderingLabel}
          </span>
          <h2 className="text-base font-semibold text-gray-50">
            Year-by-Year Estate Transfer
          </h2>
        </div>
        <p className="text-xs text-gray-400">
          Click <span className="font-semibold text-indigo-300">Taxes &amp; Expenses</span>{" "}
          on any row to see the per-decedent breakdown.
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-indigo-950/30">
            <tr className="text-[10px] uppercase tracking-[0.16em] text-indigo-300/70">
              <Th align="left">Year</Th>
              <Th align="left">Age</Th>
              <Th align="right">Gross Estate</Th>
              <Th align="right" accent>
                Taxes &amp; Expenses
              </Th>
              <Th align="right">Net To Heirs</Th>
              <Th align="right">Charity Assets</Th>
              <Th align="right">Heirs Assets</Th>
              <Th align="right">Total To Heirs</Th>
              <Th align="right">Total To Heirs &amp; Charity</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-indigo-900/20">
            {rows.map((r) => {
              const isOpen = expanded.has(r.year);
              return (
                <SummaryRow
                  key={r.year}
                  row={r}
                  isOpen={isOpen}
                  onToggle={() => toggleYear(r.year)}
                  ownerNames={ownerNames}
                />
              );
            })}
          </tbody>
          <tfoot className="border-t border-indigo-900/40">
            <tr className="bg-indigo-950/30 text-sm font-semibold text-gray-50">
              <td className="px-3 py-2" colSpan={2}>
                Lifetime totals
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-400">
                —
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">
                {fmt.format(totals.taxesAndExpenses)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">
                {fmt.format(totals.netToHeirs)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">
                {fmt.format(totals.charityAssets)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">
                {fmt.format(totals.heirsAssets)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">
                {fmt.format(totals.totalToHeirs)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">
                {fmt.format(totals.totalToHeirsAndCharity)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

interface SummaryRowProps {
  row: YearlyEstateRow;
  isOpen: boolean;
  onToggle: () => void;
  ownerNames: { clientName: string; spouseName: string | null };
}

function SummaryRow({ row, isOpen, onToggle, ownerNames }: SummaryRowProps) {
  const ageLabel =
    row.ageClient != null && row.ageSpouse != null
      ? `${row.ageClient}/${row.ageSpouse}`
      : (row.ageClient ?? row.ageSpouse ?? "—").toString();

  return (
    <>
      <tr
        className={
          isOpen
            ? "bg-indigo-900/20 text-gray-100"
            : "text-gray-200 hover:bg-indigo-900/10"
        }
      >
        <td className="px-3 py-1.5">{row.year}</td>
        <td className="px-3 py-1.5 text-gray-400">{ageLabel}</td>
        <Td>{fmt.format(row.grossEstate)}</Td>
        <td className="px-3 py-1.5 text-right">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-controls={`yearly-detail-${row.year}`}
            className={
              "inline-flex items-center gap-1.5 rounded font-mono tabular-nums " +
              "underline decoration-indigo-500/60 decoration-dotted underline-offset-4 " +
              "hover:text-indigo-200 hover:decoration-indigo-300 " +
              "focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-400 " +
              (isOpen ? "text-indigo-200" : "text-indigo-300")
            }
          >
            <Caret open={isOpen} />
            {fmt.format(row.taxesAndExpenses)}
          </button>
        </td>
        <Td>{fmt.format(row.netToHeirs)}</Td>
        <Td>{fmt.format(row.charityAssets)}</Td>
        <Td>{fmt.format(row.heirsAssets)}</Td>
        <Td bold>{fmt.format(row.totalToHeirs)}</Td>
        <Td bold>{fmt.format(row.totalToHeirsAndCharity)}</Td>
      </tr>
      {isOpen && (
        <tr id={`yearly-detail-${row.year}`} className="bg-gray-950/40">
          <td colSpan={9} className="px-3 py-3">
            <DeathDetail deaths={row.deaths} ownerNames={ownerNames} />
          </td>
        </tr>
      )}
    </>
  );
}

function DeathDetail({
  deaths,
  ownerNames,
}: {
  deaths: YearlyEstateDeathRow[];
  ownerNames: { clientName: string; spouseName: string | null };
}) {
  return (
    <div className="rounded-md border border-indigo-900/40 bg-indigo-950/20">
      <div className="border-b border-indigo-900/30 px-3 py-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-indigo-300/80">
          Tax detail by decedent
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.16em] text-indigo-300/70">
            <Th align="left">Decedent</Th>
            <Th align="right">Estate Value</Th>
            <Th align="right">Taxable Estate</Th>
            <Th align="right">State Estate / Inheritance Tax</Th>
            <Th align="right">Probate &amp; Expenses</Th>
            <Th align="right">Income Tax on IRD</Th>
            <Th align="right">Estate Tax Payable</Th>
            <Th align="right">Total Tax At Death</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-indigo-900/20">
          {deaths.map((d) => {
            const orderLabel =
              d.deathOrder === 1 ? "1st death" : "Final death";
            const altName =
              d.deceased === "client"
                ? (ownerNames.spouseName ?? "Spouse")
                : ownerNames.clientName;
            return (
              <tr key={d.deathOrder} className="text-gray-200">
                <td className="px-3 py-1.5">
                  <span className="font-medium text-gray-100">
                    {d.decedentName}
                  </span>
                  <span className="ml-2 text-xs text-gray-400">
                    {orderLabel} · survived by {altName}
                  </span>
                </td>
                <Td>{fmt.format(d.estateValue)}</Td>
                <Td>{fmt.format(d.taxableEstate)}</Td>
                <Td>{fmt.format(d.stateEstateTax)}</Td>
                <Td>{fmt.format(d.probateAndExpenses)}</Td>
                <Td>{fmt.format(d.incomeTaxOnIRD)}</Td>
                <Td>{fmt.format(d.estateTaxPayable)}</Td>
                <Td bold>{fmt.format(d.totalTaxAtDeath)}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  align,
  accent,
}: {
  children: React.ReactNode;
  align: "left" | "right";
  accent?: boolean;
}) {
  const className =
    "px-3 py-2 font-medium " +
    (align === "right" ? "text-right" : "text-left") +
    (accent ? " text-indigo-300" : "");
  return <th className={className}>{children}</th>;
}

function Td({
  children,
  bold,
}: {
  children: React.ReactNode;
  bold?: boolean;
}) {
  const className =
    "px-3 py-1.5 text-right font-mono tabular-nums " +
    (bold ? "font-semibold text-gray-50" : "text-gray-300");
  return <td className={className}>{children}</td>;
}

function Caret({ open }: { open: boolean }) {
  const style: CSSProperties = {
    transform: open ? "rotate(90deg)" : "rotate(0deg)",
    transition: "transform 120ms ease-out",
  };
  return (
    <svg
      style={style}
      width="9"
      height="9"
      viewBox="0 0 9 9"
      aria-hidden="true"
      className="opacity-70"
    >
      <path d="M2 1.5 L6 4.5 L2 7.5 Z" fill="currentColor" />
    </svg>
  );
}
