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
import { yearDetailEditResolver } from "@/lib/solver/year-detail-edit-target";
import { yearWithdrawalRate } from "@/lib/solver/withdrawal-report";
import { detailEditorTarget } from "@/lib/scenario/plan-detail-catalog";
import type { InventoryItem } from "@/lib/scenario/plan-inventory";
import type { ScenarioWriteEvent } from "@/hooks/scenario-write-listener";
import { SolverChangeEditor } from "./solver-change-editor";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
// Two decimals, matching the Withdrawals report's Withdrawal %.
const fmtPct = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const EYEBROW = "text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3";

// A name that opens its item's editor — styled like a change title on the Changes tab.
const EDIT_NAME =
  "cursor-pointer rounded text-left hover:text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent";

/** What clicking a name needs to open the Changes tab's editor for it. */
export interface YearDetailEditing {
  clientId: string;
  /** The scenario a save writes into; null on the base case, where it writes the base facts. */
  scenarioId: string | null;
  /** The persisted plan's items, as the Changes tab lists them. */
  inventory: InventoryItem[];
  /** Every scenario write the editor makes, with the name of what was edited. */
  onTargetsWritten: (events: ScenarioWriteEvent[], label: string) => void;
}

/** A row's handler that opens its item's editor, or null when its name stays plain text. */
type OpenerFor = (categoryKey: string, itemId: string) => (() => void) | null;

interface Props {
  year: ProjectionYear;
  /** The full projection — Withdrawal % measures against last year's ending portfolio. */
  years: readonly ProjectionYear[];
  clientData: ClientData;
  /** Absent for a view-only advisor: every name stays plain text. */
  editing?: YearDetailEditing;
}

export function SolverYearDetailPanel({ year, years, clientData, editing }: Props) {
  const detail = useMemo(
    () => buildCashFlowYearDetail(year, clientData),
    [year, clientData],
  );
  const netTone = detail.totals.net >= 0 ? "text-good" : "text-crit";
  // Shown only in a year the portfolio is drawn on, RMDs included.
  const withdrawalRate = yearWithdrawalRate(year, years, clientData.accounts);

  // `seq` remounts the editor on every click, so each open starts a fresh load.
  const [open, setOpen] = useState<{ item: InventoryItem; seq: number } | null>(null);
  const inventory = editing?.inventory;
  const openerFor = useMemo<OpenerFor | undefined>(() => {
    if (!inventory) return undefined;
    const itemFor = yearDetailEditResolver(inventory, clientData, year.year);
    return (categoryKey, itemId) => {
      const item = itemFor(categoryKey, itemId);
      return item && (() => setOpen((prev) => ({ item, seq: (prev?.seq ?? 0) + 1 })));
    };
  }, [inventory, clientData, year.year]);

  return (
    <div className="rounded-lg border border-hair bg-card px-5 py-4">
      <div className="mb-4 flex items-baseline gap-3">
        <span className="tabular text-[20px] font-semibold text-ink">{detail.year}</span>
        <span className="text-[14px] text-ink-3">{detail.ageLabel}</span>
      </div>

      {open && editing ? (
        <SolverChangeEditor
          key={open.seq}
          clientId={editing.clientId}
          scenarioId={editing.scenarioId}
          target={detailEditorTarget(open.item.typeKey, { intent: "edit", id: open.item.id })}
          label={open.item.label}
          onDone={() => setOpen(null)}
          onWrite={(event) => editing.onTargetsWritten([event], open.item.label)}
        />
      ) : null}

      {/* items-start: a table stretched to its taller neighbor spreads the
          extra height across its rows. */}
      <div className="grid grid-cols-1 items-start gap-x-10 gap-y-6 md:grid-cols-2">
        <div>
          <BreakdownTable
            heading="Inflows"
            categories={detail.inflows}
            totalLabel="Total Inflows"
            total={detail.totals.inflows}
            openerFor={openerFor}
          />
          {detail.withdrawals ? (
            <table className="mt-4 w-full border-collapse">
              <CategoryRows
                category={detail.withdrawals}
                help="Drawn from the portfolio when outflows exceed inflows. Not counted in Total Inflows."
                openerFor={openerFor}
              />
            </table>
          ) : null}
        </div>
        <BreakdownTable
          heading="Outflows"
          categories={detail.outflows}
          totalLabel="Total Outflows"
          total={detail.totals.outflows}
          openerFor={openerFor}
          // The chart draws Total Out as an ink line over the bars.
          totalMarker={<span className="h-0.5 w-3 rounded-full bg-ink" />}
        />
      </div>

      <dl className="mt-5 flex flex-wrap justify-center gap-x-12 gap-y-3 border-t border-hair-2 pt-4 text-center">
        <div>
          <dt className={EYEBROW}>Net Cash Flow</dt>
          <dd
            data-testid="year-detail-net"
            className={`tabular mt-1 text-[20px] font-semibold ${netTone}`}
          >
            {fmt.format(detail.totals.net)}
          </dd>
        </div>
        {withdrawalRate > 0 ? (
          <div>
            <dt className={`${EYEBROW} flex items-center justify-center gap-1.5`}>
              Withdrawal %
              <FieldTooltip text="Portfolio withdrawals plus RMDs, as a share of the portfolio at the start of the year." />
            </dt>
            <dd
              data-testid="year-detail-withdrawal-rate"
              className="tabular mt-1 text-[20px] font-semibold text-ink"
            >
              {fmtPct.format(withdrawalRate)}
            </dd>
          </div>
        ) : null}
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
  openerFor,
}: {
  heading: string;
  categories: CashFlowCategory[];
  totalLabel: string;
  total: number;
  totalMarker?: ReactNode;
  openerFor?: OpenerFor;
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
        <CategoryRows key={c.key} category={c} openerFor={openerFor} />
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

function CategoryRows({
  category,
  help,
  openerFor,
}: {
  category: CashFlowCategory;
  help?: string;
  openerFor?: OpenerFor;
}) {
  const [open, setOpen] = useState(true);
  const expandable = category.items.length > 0;
  const color = CASH_FLOW_INFLOW_COLORS[category.key as keyof typeof CASH_FLOW_INFLOW_COLORS];
  // With no item rows to toggle, the category row opens the one item it stands for.
  const openSole = category.soleItemId ? openerFor?.(category.key, category.soleItemId) : null;

  return (
    <tbody className="border-b border-hair">
      <tr>
        <th scope="row" className="py-2 text-left text-[15px] font-semibold text-ink">
          <span className="flex items-center gap-2">
            <button
              type="button"
              disabled={!expandable && !openSole}
              aria-expanded={expandable ? open : undefined}
              aria-label={openSole ? `Edit ${category.label}` : undefined}
              onClick={openSole ?? (() => setOpen((v) => !v))}
              className={`flex items-center gap-2 text-left ${openSole ? EDIT_NAME : "enabled:hover:text-ink-2"}`}
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
            const openItem = openerFor?.(category.key, it.id);
            return (
              <tr key={it.id} className="text-[14px] text-ink-3">
                {/* Indented past the chevron + swatch, under the category label. */}
                <td className={`pl-[42px] ${pad}`}>
                  {openItem ? (
                    <button
                      type="button"
                      aria-label={`Edit ${it.label}`}
                      onClick={openItem}
                      className={EDIT_NAME}
                    >
                      {it.label}
                    </button>
                  ) : (
                    it.label
                  )}
                </td>
                <td className={`tabular text-right ${pad}`}>{fmt.format(it.amount)}</td>
              </tr>
            );
          })
        : null}
    </tbody>
  );
}
