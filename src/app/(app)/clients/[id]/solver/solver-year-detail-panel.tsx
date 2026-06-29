"use client";

import { useMemo, useState } from "react";
import type { ClientData, ProjectionYear } from "@/engine";
import {
  buildCashFlowYearDetail,
  type CashFlowCategory,
} from "@/lib/solver/cashflow-year-detail";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

interface Props {
  year: ProjectionYear;
  clientData: ClientData;
}

export function SolverYearDetailPanel({ year, clientData }: Props) {
  const detail = useMemo(
    () => buildCashFlowYearDetail(year, clientData),
    [year, clientData],
  );
  const netTone = detail.totals.net >= 0 ? "text-pos" : "text-crit";

  return (
    <div className="rounded-lg border border-hair bg-card px-4 py-3">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-[15px] font-semibold text-ink">{detail.year}</span>
        <span className="text-[12px] text-ink-3">{detail.ageLabel}</span>
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
        <Column heading="Inflows" categories={detail.inflows} />
        <Column heading="Outflows" categories={detail.outflows} />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1 border-t border-hair pt-2 text-[12px] sm:grid-cols-2">
        <TotalRow label="Total Inflows" amount={detail.totals.inflows} />
        <TotalRow label="Total Outflows" amount={detail.totals.outflows} />
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-hair pt-2">
        <span className="text-[12px] font-medium text-ink-3">Net Cash Flow</span>
        <span data-testid="year-detail-net" className={`text-[14px] font-semibold ${netTone}`}>
          {fmt.format(detail.totals.net)}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[11px] text-ink-4">Ending Portfolio</span>
        <span className="text-[12px] text-ink-3">{fmt.format(detail.totals.endingPortfolio)}</span>
      </div>
    </div>
  );
}

function Column({ heading, categories }: { heading: string; categories: CashFlowCategory[] }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-4">
        {heading}
      </div>
      {categories.map((c) => (
        <CategoryRow key={c.key} category={c} />
      ))}
    </div>
  );
}

function CategoryRow({ category }: { category: CashFlowCategory }) {
  const [open, setOpen] = useState(false);
  const expandable = category.items.length > 0;

  return (
    <div>
      <button
        type="button"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => expandable && setOpen((v) => !v)}
        className={`flex w-full items-center justify-between py-1 text-[13px] ${
          expandable ? "text-ink hover:text-accent" : "text-ink cursor-default"
        }`}
      >
        <span className="flex items-center gap-1">
          {expandable ? (
            <span aria-hidden="true" className="text-ink-4">{open ? "▾" : "▸"}</span>
          ) : (
            <span aria-hidden="true" className="w-[1ch]" />
          )}
          {category.label}
        </span>
        <span className="tabular-nums text-ink-3">{fmt.format(category.total)}</span>
      </button>
      {expandable && open ? (
        <div className="mb-1 ml-[1.4ch] border-l border-hair-2 pl-2">
          {category.items.map((it) => (
            <div key={it.id} className="flex items-center justify-between py-0.5 text-[12px] text-ink-3">
              <span>{it.label}</span>
              <span className="tabular-nums">{fmt.format(it.amount)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TotalRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-medium text-ink-3">{label}</span>
      <span className="tabular-nums text-ink">{fmt.format(amount)}</span>
    </div>
  );
}
