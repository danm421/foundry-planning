"use client";

import { memo } from "react";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import type { DollarBasis, MonthlyCashFlowRow } from "@/lib/solver/monthly-cash-flow";
import type { MonthRow } from "@/lib/solver/monthly-allocation";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Below a dollar a month the leftover is float dust that would render as "$0".
 *  Above it, it is a real number the parts could not account for and it gets
 *  its own row — it is never folded into one of the named lines. */
const UNEXPLAINED_FLOOR = 1;

interface Props {
  rows: MonthlyCashFlowRow[];
  /** Follows the chart above; `null` until the advisor picks a year. */
  selectedYear: number | null;
  onYearClick: (year: number) => void;
  basis: DollarBasis;
  onBasisChange: (b: DollarBasis) => void;
  /** The selected year split into twelve months. Optional so the fourteen tests
   *  that predate the toggle keep compiling; the one production caller always
   *  passes it. */
  monthRows?: MonthRow[];
  /** Defaults to the table this panel has always shown, so a caller that forgets
   *  the toggle degrades to today's behaviour rather than to a blank table. */
  view?: "plan" | "months";
  onViewChange?: (v: "plan" | "months") => void;
}

/**
 * Which year the month table is about.
 *
 * EXPORTED AND SHARED ON PURPOSE. `solver-chart-panel.tsx` builds the twelve
 * rows for the same year this panel captions, and the rule is not the obvious
 * one: with no year picked it opens on the first SHORTFALL year, not the first
 * year. A second copy that omitted the middle clause would caption one year and
 * list another's months on first open, silently — `selectedYear` is null every
 * time the Monthly sub-tab is opened.
 */
export function selectMonthlyRow(
  rows: MonthlyCashFlowRow[],
  selectedYear: number | null,
): MonthlyCashFlowRow | undefined {
  return (
    rows.find((r) => r.year === selectedYear) ??
    rows.find((r) => r.income < r.fixed.total) ??
    rows[0]
  );
}

// Memoized for the same reason `SolverWithdrawalPanel` is: this table renders
// into the report panel's always-mounted inline-table slot, and the chart-height
// drag re-renders that panel on every pointermove without changing a single
// prop here.
export const SolverMonthlyCashFlowPanel = memo(function SolverMonthlyCashFlowPanel({
  rows,
  selectedYear,
  onYearClick,
  basis,
  onBasisChange,
  monthRows = [],
  view = "plan",
  onViewChange,
}: Props) {
  if (rows.length === 0) {
    return (
      <div className="mt-3 rounded-md border border-hair-2 bg-card-2 px-4 py-5 text-sm text-ink-2">
        No projection years to show.
      </div>
    );
  }

  // Opens on the first shortfall year rather than year one — this report exists
  // for the retirement conversation. The rule itself lives on `selectMonthlyRow`
  // because the chart panel has to pick the SAME year; `rows.length === 0`
  // returned above, so it cannot come back empty here.
  const selected = selectMonthlyRow(rows, selectedYear)!;

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1" role="group" aria-label="Table view">
          <BasisButton
            label="Across the plan"
            active={view === "plan"}
            onClick={() => onViewChange?.("plan")}
          />
          <BasisButton
            label="Month by month"
            active={view === "months"}
            onClick={() => onViewChange?.("months")}
          />
        </div>
        <div className="flex items-center justify-end gap-1" role="group" aria-label="Dollar basis">
          <BasisButton
            label="Today's dollars"
            active={basis === "today"}
            onClick={() => onBasisChange("today")}
          />
          <BasisButton
            label="Future dollars"
            active={basis === "nominal"}
            onClick={() => onBasisChange("nominal")}
          />
        </div>
      </div>

      <div className="rounded-lg border border-hair bg-card px-4 py-3">
        <div className="mb-2 flex items-baseline gap-2">
          <span className="text-[15px] font-semibold text-ink">{selected.year}</span>
          <span className="text-[12px] text-ink-3">{selected.ageLabel}</span>
        </div>

        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-4">
          Available each month
          <FieldTooltip text="Everything the household has to live on that month — living expenses included. Income minus the costs already committed (taxes, debt, savings, insurance, property, other), plus whatever the portfolio has to supply." />
        </div>
        <div
          data-testid="monthly-available"
          className="text-[28px] font-semibold tabular-nums text-ink"
        >
          {fmt.format(selected.available)}
        </div>

        <div className="mt-3 space-y-1 border-t border-hair pt-2 text-[12px]">
          <Line
            testId="monthly-left-after-fixed"
            label="Left after fixed costs"
            amount={selected.leftAfterFixed}
            tone={selected.leftAfterFixed < 0 ? "text-crit" : "text-ink-3"}
          />
          <Line
            testId="monthly-draw"
            label="Portfolio draw"
            amount={selected.portfolioDraw}
            tone="text-ink-3"
          />
        </div>

        {/* Only when the portfolio actually is supplying it. When the money has
            run out the engine overdrafts instead of withdrawing — no draw is
            booked at all — and this sentence would be describing a rescue that
            never happened. */}
        {selected.leftAfterFixed < 0 && selected.portfolioDraw > 0 ? (
          <p className="mt-2 text-[11px] text-ink-4">
            Income covers {fmt.format(selected.income)} of {fmt.format(selected.fixed.total)} in
            fixed costs — the portfolio supplies the rest.
          </p>
        ) : null}

        {selected.depleted ? (
          <p className="mt-2 rounded border border-crit/40 bg-crit/10 px-2 py-1.5 text-[11px] text-crit">
            The accounts are exhausted this year. The plan keeps spending against an overdrawn
            account, so this figure is money that does not exist.
          </p>
        ) : null}

        <div className="mt-3 border-t border-hair pt-2 text-[12px]">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-4">
            Where it goes
          </div>
          <Line label="Living expenses" amount={selected.split.living} tone="text-ink-3" />
          <Line label="Surplus spent" amount={selected.split.surplusSpent} tone="text-ink-3" />
          <Line label="Surplus unspent" amount={selected.split.surplusUnspent} tone="text-ink-3" />
          {Math.abs(selected.split.unexplained) >= UNEXPLAINED_FLOOR ? (
            <Line
              testId="monthly-unexplained"
              label="Unaccounted for"
              amount={selected.split.unexplained}
              tone="text-ink-4"
            />
          ) : null}
        </div>
      </div>

      {view === "plan" ? (
        <div className="overflow-x-auto rounded-lg border border-hair bg-card">
          <table className="min-w-full text-sm">
            <caption className="sr-only">
              Month-by-month cash flow for every plan year: income and the portfolio draw that tops
              it up, the costs already committed, and what is left to live on
            </caption>
            <thead className="text-xs uppercase text-ink-3">
              <tr>
                <Th align="left">Year</Th>
                <Th align="left">Age</Th>
                <Th>Income</Th>
                {/* Sits WITH Income, ahead of the costs, because it is money in.
                    Sitting among the cost columns it would read as a fifth cost
                    and the row would still not add up. In this order it does:
                    income + draw − taxes − debt − savings − other = available,
                    which is why the column needs no note explaining its sign. */}
                <Th>Portfolio draw</Th>
                <Th>Taxes</Th>
                <Th>Debt</Th>
                <Th>Savings</Th>
                <Th>Other</Th>
                <Th>Available</Th>
              </tr>
            </thead>
            <tbody className="text-ink">
              {rows.map((r) => (
                <tr key={r.year} className={r.year === selected.year ? "bg-accent-wash" : undefined}>
                  <td className="border-b border-hair px-3 py-2 text-left">
                    <button
                      type="button"
                      onClick={() => onYearClick(r.year)}
                      title={`Show ${r.year} above`}
                      className="rounded-sm text-ink hover:text-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      {r.year}
                    </button>
                    {r.depleted ? (
                      // Shape and label, not colour alone — the flag has to survive
                      // a colour-blind reader and a greyscale print of the report.
                      <span
                        aria-label="Accounts exhausted"
                        title="Accounts exhausted — this year's figure is money that does not exist"
                        className="ml-1 font-semibold text-crit"
                      >
                        !
                      </span>
                    ) : null}
                  </td>
                  <Td align="left" tone="text-ink-3">
                    {r.ageLabel}
                  </Td>
                  <Td>{fmt.format(r.income)}</Td>
                  <Td>{fmt.format(r.portfolioDraw)}</Td>
                  <Td>{fmt.format(r.fixed.taxes)}</Td>
                  <Td>{fmt.format(r.fixed.liabilities)}</Td>
                  <Td>{fmt.format(r.fixed.savings)}</Td>
                  <Td>{fmt.format(r.fixed.insurance + r.fixed.realEstate + r.fixed.other)}</Td>
                  <Td tone="font-medium text-ink">{fmt.format(r.available)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="overflow-x-auto rounded-lg border border-hair bg-card">
            <table className="min-w-full text-sm">
              <caption className="sr-only">
                {selected.year} month by month: what comes in, what is already committed, what is
                left to live on, and the running cash-flow total each month closes at
              </caption>
              <thead className="text-xs uppercase text-ink-3">
                <tr>
                  <Th align="left">Month</Th>
                  <Th>Income</Th>
                  {/* Same order as the year table above, and for the same reason:
                      money in sits ahead of the costs, so the row reads left to
                      right as the arithmetic that produces Net. */}
                  <Th>Portfolio draw</Th>
                  <Th>Taxes</Th>
                  <Th>Debt</Th>
                  <Th>Savings</Th>
                  <Th>Other</Th>
                  <Th>Living</Th>
                  <Th>Net</Th>
                  <Th>Cash on hand</Th>
                </tr>
              </thead>
              <tbody className="text-ink">
                {monthRows.map((m) => (
                  <tr key={m.month} data-testid="month-row">
                    <Td align="left" tone="text-ink-3">
                      {m.label}
                    </Td>
                    <Td>{fmt.format(m.income)}</Td>
                    <Td>{fmt.format(m.portfolioDraw)}</Td>
                    <Td>{fmt.format(m.taxes)}</Td>
                    {/* Printed exactly as the allocator returned it. A
                        mid-year-originated entity-owned loan really does produce
                        negative debt months, and clamping one to zero would turn
                        a row that reconciles into one that silently does not. */}
                    <Td>{fmt.format(m.debt)}</Td>
                    <Td>{fmt.format(m.savings)}</Td>
                    <Td>{fmt.format(m.other)}</Td>
                    <Td>{fmt.format(m.living)}</Td>
                    <Td tone={m.net < 0 ? "text-crit" : "text-ink-2"}>{fmt.format(m.net)}</Td>
                    <Td tone={m.cashOnHand < 0 ? "font-medium text-crit" : "font-medium text-ink"}>
                      {fmt.format(m.cashOnHand)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* VISIBLE on purpose, not an sr-only caption. "Cash on hand" opens at
              the household's liquid balance and then carries this table's own net
              forward — it adds the portfolio draw (money LEAVING those same
              accounts) and subtracts savings (money ENTERING them), and never adds
              growth. In a drawdown year it therefore runs high by roughly the
              whole year's draw. It answers "is the month short?", not "what is in
              the account?", and an advisor reading it as a balance would overstate
              the client's liquid position. */}
          <p className="px-1 text-[11px] text-ink-3" data-testid="cash-on-hand-note">
            Cash on hand is a running cash-flow total, not an account balance — it opens at this
            household&apos;s liquid savings and carries each month&apos;s net forward. It ignores
            growth and treats a portfolio withdrawal as money in, so it shows whether a month is
            short, not what the accounts hold.
          </p>

          {/* Only in the years it is true of. `net` subtracts a surplus-spending
              term that has no column of its own, so those rows genuinely do not
              add up across the columns shown. Discretionary spend is zero on most
              plans, and an always-on footnote would read as true of every year. */}
          {selected.split.surplusSpent > 0 ? (
            <p className="px-1 text-[11px] text-ink-3" data-testid="surplus-spent-note">
              In {selected.year} the plan also spends {fmt.format(selected.split.surplusSpent)} of
              surplus. That comes out of Net without a column of its own, so these rows will not
              add across.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
});

function BasisButton({
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
      className={`rounded border px-2 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-accent ${
        active
          ? "border-accent font-medium text-accent"
          : "border-transparent text-ink-3 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function Line({
  label,
  amount,
  tone,
  testId,
}: {
  label: string;
  amount: number;
  tone: string;
  testId?: string;
}) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-ink-3">{label}</span>
      <span data-testid={testId} className={`tabular-nums ${tone}`}>
        {fmt.format(amount)}
      </span>
    </div>
  );
}

function Th({ children, align = "right" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className={`border-b border-hair px-3 py-2 font-medium ${align === "left" ? "text-left" : "text-right"}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "right",
  tone = "text-ink-2",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  tone?: string;
}) {
  return (
    <td
      className={`border-b border-hair px-3 py-2 tabular-nums ${align === "left" ? "text-left" : "text-right"} ${tone}`}
    >
      {children}
    </td>
  );
}
