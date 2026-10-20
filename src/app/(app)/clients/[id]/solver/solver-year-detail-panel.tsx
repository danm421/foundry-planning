"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { ClientData, ProjectionYear } from "@/engine";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { ChevronDownIcon } from "@/components/icons";
import {
  buildCashFlowYearDetail,
  CASH_FLOW_INFLOW_COLORS,
  type CashFlowCategory,
} from "@/lib/solver/cashflow-year-detail";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const EYEBROW = "text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3";

interface Props {
  year: ProjectionYear;
  clientData: ClientData;
}

export function SolverYearDetailPanel({ year, clientData }: Props) {
  const detail = useMemo(
    () => buildCashFlowYearDetail(year, clientData),
    [year, clientData],
  );
  const netTone = detail.totals.net >= 0 ? "text-good" : "text-crit";

  return (
    <div className="rounded-lg border border-hair bg-card px-5 py-4">
      <div className="mb-4 flex items-baseline gap-3">
        <span className="tabular text-[20px] font-semibold text-ink">{detail.year}</span>
        <span className="text-[14px] text-ink-3">{detail.ageLabel}</span>
      </div>

      {/* items-start: a table stretched to its taller neighbor spreads the
          extra height across its rows. */}
      <div className="grid grid-cols-1 items-start gap-x-10 gap-y-6 md:grid-cols-2">
        <div>
          <BreakdownTable
            heading="Inflows"
            categories={detail.inflows}
            totalLabel="Total Inflows"
            total={detail.totals.inflows}
          />
          {detail.withdrawals ? (
            <table className="mt-4 w-full border-collapse">
              <CategoryRows
                category={detail.withdrawals}
                help="Drawn from the portfolio when outflows exceed inflows. Not counted in Total Inflows."
              />
            </table>
          ) : null}
        </div>
        <BreakdownTable
          heading="Outflows"
          categories={detail.outflows}
          totalLabel="Total Outflows"
          total={detail.totals.outflows}
          // The chart draws Total Out as an ink line over the bars.
          totalMarker={<span className="h-0.5 w-3 rounded-full bg-ink" />}
        />
      </div>

      <dl className="mt-5 flex flex-wrap gap-x-12 gap-y-3 border-t border-hair-2 pt-4">
        <div>
          <dt className={EYEBROW}>Net Cash Flow</dt>
          <dd
            data-testid="year-detail-net"
            className={`tabular mt-1 text-[20px] font-semibold ${netTone}`}
          >
            {fmt.format(detail.totals.net)}
          </dd>
        </div>
        <div>
          <dt className={EYEBROW}>Ending Portfolio</dt>
          <dd className="tabular mt-1 text-[20px] font-semibold text-ink">
            {fmt.format(detail.totals.endingPortfolio)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function BreakdownTable({
  heading,
  categories,
  totalLabel,
  total,
  totalMarker,
}: {
  heading: string;
  categories: CashFlowCategory[];
  totalLabel: string;
  total: number;
  totalMarker?: ReactNode;
}) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b border-hair-2">
          <th scope="col" className={`pb-2 text-left ${EYEBROW}`}>{heading}</th>
          <th scope="col" className={`pb-2 text-right ${EYEBROW}`}>Amount</th>
        </tr>
      </thead>
      {categories.map((c) => (
        <CategoryRows key={c.key} category={c} />
      ))}
      <tfoot>
        <tr className="border-t border-hair-2">
          <th scope="row" className="pt-2.5 text-left text-[15px] font-semibold text-ink">
            <span className="flex items-center gap-2">
              {/* Spans the chevron + swatch columns, so the label lines up
                  with the category labels above. */}
              <span aria-hidden="true" className="flex w-[34px] shrink-0 justify-end">
                {totalMarker}
              </span>
              {totalLabel}
            </span>
          </th>
          <td className="tabular pt-2.5 text-right text-[15px] font-semibold text-ink">
            {fmt.format(total)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function CategoryRows({ category, help }: { category: CashFlowCategory; help?: string }) {
  const [open, setOpen] = useState(true);
  const expandable = category.items.length > 0;
  const color = CASH_FLOW_INFLOW_COLORS[category.key as keyof typeof CASH_FLOW_INFLOW_COLORS];

  return (
    <tbody className="border-b border-hair">
      <tr>
        <th scope="row" className="py-2 text-left text-[15px] font-semibold text-ink">
          <span className="flex items-center gap-2">
            <button
              type="button"
              disabled={!expandable}
              aria-expanded={expandable ? open : undefined}
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-2 text-left enabled:hover:text-ink-2"
            >
              <span aria-hidden="true" className="flex w-4 shrink-0 justify-center text-ink-3">
                {expandable ? (
                  <ChevronDownIcon
                    width={16}
                    height={16}
                    className={`transition-transform ${open ? "" : "-rotate-90"}`}
                  />
                ) : null}
              </span>
              {/* An outflow has no bar to match, so it gets a neutral marker —
                  still anchoring the category row against its items. */}
              <span
                aria-hidden="true"
                className={`h-2.5 w-2.5 shrink-0 rounded-[3px] ${color ? "" : "bg-ink-4"}`}
                style={color ? { backgroundColor: `var(--data-${color})` } : undefined}
              />
              {category.label}
            </button>
            {help ? <FieldTooltip text={help} /> : null}
          </span>
        </th>
        <td className="tabular py-2 text-right text-[15px] font-semibold text-ink">
          {fmt.format(category.total)}
        </td>
      </tr>
      {expandable && open
        ? category.items.map((it, i) => {
            const pad = i === category.items.length - 1 ? "pb-2" : "pb-1";
            return (
              <tr key={it.id} className="text-[14px] text-ink-3">
                {/* Indented past the chevron + swatch, under the category label. */}
                <td className={`pl-[42px] ${pad}`}>{it.label}</td>
                <td className={`tabular text-right ${pad}`}>{fmt.format(it.amount)}</td>
              </tr>
            );
          })
        : null}
    </tbody>
  );
}
