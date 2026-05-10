"use client";

import { useMemo } from "react";
import type { ProjectionYear } from "@/engine";
import { buildTaxBracketRows } from "@/lib/reports/tax-bracket";

interface TaxBracketTabProps {
  years: ProjectionYear[];
  onCellClick: (year: number, columnKey: "conversionGross" | "conversionTaxable" | "intoBracket") => void;
}

function fmtUsd(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.round(n));
  return `${sign}$${abs.toLocaleString("en-US")}`;
}

function fmtAges(client: number, spouse: number | null): string {
  return spouse == null ? `${client}` : `${client}/${spouse}`;
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

export function TaxBracketTab({ years, onCellClick }: TaxBracketTabProps) {
  const rows = useMemo(() => buildTaxBracketRows(years), [years]);

  return (
    <div className="rounded-md bg-stone-950 p-5 text-amber-100">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold tracking-tight">Tax Bracket</h3>
          <span className="rounded-md border border-amber-900/40 bg-amber-950/40 px-2.5 py-1 text-xs text-amber-200/80">
            All Years
          </span>
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
              <tr key={r.year} className="border-t border-amber-200/10">
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
    </div>
  );
}
