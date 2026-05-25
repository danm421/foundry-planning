"use client";

import { useMemo } from "react";
import type { ProjectionYear } from "@/engine";

interface Props {
  years: ProjectionYear[];
  yearRange: [number, number];
  onRowClick?: (year: ProjectionYear) => void;
}

function fmt(n: number) {
  return n === 0 ? "—" : `$${Math.round(n).toLocaleString()}`;
}

function fmtHeadroom(n: number) {
  if (n === Infinity) return "Top tier";
  if (n === 0) return "$0";
  return `$${Math.round(n).toLocaleString()}`;
}

export function MedicareYearTable({ years, yearRange, onRowClick }: Props) {
  const rows = useMemo(
    () =>
      years.filter(
        (y) => y.year >= yearRange[0] && y.year <= yearRange[1] && y.medicare,
      ),
    [years, yearRange],
  );

  return (
    <div className="overflow-x-auto rounded border border-line-2">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-ink-3 text-[11px] uppercase">
          <tr>
            <th className="px-3 py-2 text-left">Year</th>
            <th className="px-3 py-2 text-left">Ages</th>
            <th className="px-3 py-2 text-left">Filing</th>
            <th className="px-3 py-2 text-right">Source MAGI</th>
            <th className="px-3 py-2 text-center">Tier</th>
            <th className="px-3 py-2 text-right">Part B</th>
            <th className="px-3 py-2 text-right">Part D</th>
            <th className="px-3 py-2 text-right">Medigap</th>
            <th className="px-3 py-2 text-right">Total</th>
            <th className="px-3 py-2 text-right">Headroom</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((y, idx) => {
            const d = y.medicare!.client ?? y.medicare!.spouse;
            if (!d) return null;
            const prevMedicare = idx > 0 ? rows[idx - 1]!.medicare : null;
            const prev = prevMedicare
              ? prevMedicare.client ?? prevMedicare.spouse
              : null;
            const tierChanged = prev !== null && prev !== undefined && prev.irmaaTier !== d.irmaaTier;
            const tierArrow = tierChanged
              ? d.irmaaTier > (prev?.irmaaTier ?? 0)
                ? " ⬆"
                : " ⬇"
              : "";

            const headroomColor =
              d.headroomToNextTier === Infinity
                ? "text-ink-3"
                : d.headroomToNextTier === 0
                  ? "text-red-600"
                  : d.headroomToNextTier < 10_000
                    ? "text-amber-600"
                    : "text-emerald-600";

            const tierColor =
              d.irmaaTier >= 3
                ? "text-red-700"
                : d.irmaaTier >= 1
                  ? "text-amber-700"
                  : "text-emerald-700";

            return (
              <tr
                key={y.year}
                className={`border-t border-line-2 cursor-pointer hover:bg-surface-2 ${tierChanged ? "bg-amber-50/40" : ""}`}
                onClick={() => onRowClick?.(y)}
                title={tierChanged ? "Tier change vs prior year" : undefined}
              >
                <td className="px-3 py-1.5">{y.year}</td>
                <td className="px-3 py-1.5">
                  {y.ages.client}
                  {y.ages.spouse !== undefined ? ` / ${y.ages.spouse}` : ""}
                </td>
                <td className="px-3 py-1.5">{d.irmaaFilingStatus.toUpperCase()}</td>
                <td
                  className="px-3 py-1.5 text-right"
                  title={
                    d.isColdStart
                      ? "Cold-start: from priorYearMagi or year-0 projection"
                      : `From ${d.sourceYearForIrmaa}`
                  }
                >
                  ${Math.round(d.sourceMagi).toLocaleString()}
                  {d.isColdStart && (
                    <span className="text-[10px] text-ink-3 ml-1">*</span>
                  )}
                </td>
                <td className={`px-3 py-1.5 text-center font-medium ${tierColor}`}>
                  T{d.irmaaTier}
                  {tierArrow}
                </td>
                <td className="px-3 py-1.5 text-right">{fmt(d.partBPremium)}</td>
                <td className="px-3 py-1.5 text-right">{fmt(d.partDPremium)}</td>
                <td className="px-3 py-1.5 text-right">{fmt(d.medigapPremium)}</td>
                <td className="px-3 py-1.5 text-right font-medium">
                  {fmt(y.medicare!.totalAnnualCost)}
                </td>
                <td className={`px-3 py-1.5 text-right ${headroomColor}`}>
                  {fmtHeadroom(d.headroomToNextTier)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
