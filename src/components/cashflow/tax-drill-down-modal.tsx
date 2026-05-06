"use client";

import { useState } from "react";
import type { ClientData, ProjectionYear } from "@/engine";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function fmtNum(v: number) {
  return fmt.format(v);
}

interface TaxDrillDownModalProps {
  year: number;
  detail: NonNullable<ProjectionYear["taxDetail"]>;
  totalTaxes: number;
  accountNames: Record<string, string>;
  incomes: ClientData["incomes"];
  onClose: () => void;
}

export function TaxDrillDownModal({
  year,
  detail,
  totalTaxes,
  accountNames,
  incomes,
  onClose,
}: TaxDrillDownModalProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border-2 border-ink-3 ring-1 ring-black/60 bg-gray-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-100">Tax Detail — {year}</h3>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-200">✕</button>
        </div>

        <p className="mb-3 text-xs text-gray-400">Click a category to see the sources.</p>

        <div className="space-y-2">
          {[
            { label: "Earned Income", key: "earnedIncome" as const, taxType: "earned_income" },
            { label: "Ordinary Income", key: "ordinaryIncome" as const, taxType: "ordinary_income" },
            { label: "Dividends", key: "dividends" as const, taxType: "dividends" },
            { label: "Capital Gains (LT)", key: "capitalGains" as const, taxType: "capital_gains" },
            { label: "ST Capital Gains", key: "stCapitalGains" as const, taxType: "stcg" },
            { label: "QBI", key: "qbi" as const, taxType: "qbi" },
            { label: "Tax-Exempt", key: "taxExempt" as const, taxType: "tax_exempt" },
          ]
            .filter((row) => detail[row.key] > 0)
            .map((row) => {
              const isExpanded = expanded.has(row.key);
              const sources = Object.entries(detail.bySource)
                .filter(([, v]) => v.type === row.taxType)
                .map(([sourceId, v]) => {
                  if (sourceId.includes(":")) {
                    const [acctId, kind] = sourceId.split(":");
                    const suffix =
                      kind === "oi" ? "OI"
                      : kind === "qdiv" ? "Qual Div"
                      : kind === "stcg" ? "ST CG"
                      : kind === "rmd" ? "RMD"
                      : kind;
                    const name = accountNames[acctId] ?? acctId;
                    return { id: sourceId, label: `${name} — ${suffix}`, amount: v.amount };
                  }
                  const inc = incomes.find((i) => i.id === sourceId);
                  return { id: sourceId, label: inc?.name ?? sourceId, amount: v.amount };
                })
                .sort((a, b) => b.amount - a.amount);

              return (
                <div key={row.key} className="rounded-md bg-gray-800/40 text-sm">
                  <button
                    type="button"
                    onClick={() => {
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(row.key)) next.delete(row.key);
                        else next.add(row.key);
                        return next;
                      });
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-gray-800/70"
                    disabled={sources.length === 0}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{sources.length > 0 ? (isExpanded ? "▾" : "▸") : " "}</span>
                      <span className="font-medium text-gray-200">{row.label}</span>
                    </span>
                    <span className="tabular-nums text-gray-300">{fmtNum(detail[row.key])}</span>
                  </button>
                  {isExpanded && sources.length > 0 && (
                    <ul className="divide-y divide-gray-800 border-t border-gray-800">
                      {sources.map((s) => (
                        <li key={s.id} className="flex items-center justify-between px-3 py-1.5 pl-8 text-xs">
                          <span className="truncate text-gray-300">{s.label}</span>
                          <span className="tabular-nums text-gray-300">{fmtNum(s.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
        </div>

        <div className="mt-4 flex justify-between border-t border-gray-700 pt-3 text-sm font-semibold text-gray-100">
          <span>Total Taxes</span>
          <span className="tabular-nums">{fmtNum(totalTaxes)}</span>
        </div>
      </div>
    </div>
  );
}
