"use client";

import { memo } from "react";
import {
  selectMonthlyRow,
  type DollarBasis,
  type MonthlyCashFlowRow,
} from "@/lib/solver/monthly-cash-flow";
import {
  rankDistributionAccounts,
  type DistributionRow,
  type MonthlyMode,
} from "@/lib/solver/monthly-distributions";
import { BasisButton } from "./solver-monthly-cash-flow-panel";
import { MonthlyModeSwitch } from "./solver-monthly-mode-switch";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Under a dollar a month a line would print as "$0" or be float dust. */
const MIN_LINE = 1;

interface Props {
  rows: DistributionRow[];
  /** The Cash flow rows, ONLY so the captioned year follows `selectMonthlyRow`. */
  cashFlowRows: MonthlyCashFlowRow[];
  selectedYear: number | null;
  onYearClick: (year: number) => void;
  basis: DollarBasis;
  onBasisChange: (b: DollarBasis) => void;
  mode: MonthlyMode;
  onModeChange: (m: MonthlyMode) => void;
}

export const SolverMonthlyDistributionsPanel = memo(
  function SolverMonthlyDistributionsPanel({
    rows,
    cashFlowRows,
    selectedYear,
    onYearClick,
    basis,
    onBasisChange,
    mode,
    onModeChange,
  }: Props) {
    if (rows.length === 0) {
      return (
        <div className="mt-3 rounded-md border border-hair-2 bg-card-2 px-4 py-5 text-sm text-ink-2">
          No projection years to show.
        </div>
      );
    }

    const year =
      selectMonthlyRow(cashFlowRows, selectedYear)?.year ?? rows[0].year;
    const selected = rows.find((r) => r.year === year) ?? rows[0];
    const ranked = rankDistributionAccounts(rows);
    const rankedIds = new Set(ranked.map((a) => a.accountId));
    const accountCount = new Set(
      rows.flatMap((r) => r.fromAccounts.accounts.map((a) => a.accountId)),
    ).size;
    const showOther = accountCount > ranked.length;

    const { need, fromAccounts: from } = selected;
    const needLines = [
      { label: "Living expenses", amount: need.living },
      { label: "Debt payments", amount: need.liabilities },
      { label: "Real estate", amount: need.realEstate },
      { label: "Insurance", amount: need.insurance },
      ...need.goalLines.map((g) => ({
        label: `${g.name} (goal)`,
        amount: g.amount,
      })),
      { label: "Other expenses", amount: need.other },
      { label: "Savings contributions", amount: need.savings },
    ].filter((l) => l.amount >= MIN_LINE);

    const madeOf: { label: string; amount: number }[] = [
      { label: "spending", amount: from.parts.spending },
      { label: "taxes", amount: from.parts.taxes },
      { label: "goal shortfall", amount: from.parts.goalShortfall },
      { label: "extra spending of surplus", amount: from.parts.surplusSpent },
      {
        label: "extra spending (whatever's left)",
        amount: from.parts.absorbedExtra,
      },
      {
        label: "more than needed — reinvested / kept in cash",
        amount: from.parts.keptOrReinvested,
      },
    ].filter((p) => Math.abs(p.amount) >= 0.5);
    const showUnexplained = Math.abs(from.unexplained) >= MIN_LINE;
    const madeOfText = madeOf
      .map((p, i) => {
        const sign = p.amount < 0 ? "−" : i === 0 ? "" : "+";
        const body = `${fmt.format(Math.abs(p.amount))} ${p.label}`;
        return i === 0 ? `${sign}${body}` : `${sign} ${body}`;
      })
      .join(" ");

    return (
      <div className="mt-3 space-y-3">
        <div className="flex items-center justify-between gap-1">
          <MonthlyModeSwitch mode={mode} onChange={onModeChange} />
          <div
            className="flex items-center justify-end gap-1"
            role="group"
            aria-label="Dollar basis"
          >
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

        <div className="flex items-baseline gap-2">
          <span
            data-testid="distributions-year"
            className="text-[15px] font-semibold text-ink"
          >
            {selected.year}
          </span>
          <span className="text-[12px] text-ink-3">{selected.ageLabel}</span>
        </div>

        {selected.depleted ? (
          <p className="rounded border border-crit/40 bg-crit/10 px-2 py-1.5 text-[11px] text-crit">
            † The accounts are exhausted this year. The plan keeps spending
            against an overdrawn account, so this figure is money that does not
            exist.
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-2.5">
            <div
              data-testid="distributions-need"
              className="rounded-lg border border-hair border-l-[3px] border-l-data-teal bg-card px-3 py-2.5 text-[13px]"
            >
              <Eyebrow>Monthly spending need</Eyebrow>
              <div className="text-2xl font-semibold tabular text-ink">
                {fmt.format(need.total)}
              </div>
              <div className="text-[11.5px] text-ink-3">
                Before taxes · not counting goals paid from set-aside accounts
              </div>
              <div className="my-1.5 border-t border-hair" />
              {needLines.map((l) => (
                <Row
                  key={l.label}
                  label={l.label}
                  amount={fmt.format(l.amount)}
                  indent
                />
              ))}
              <div className="my-1.5 border-t border-hair" />
              <Row
                label={
                  <>
                    Covered by income
                    {selected.income.sources.length > 0 ? (
                      <span className="text-ink-3">
                        {" "}
                        (
                        {selected.income.sources.map((s) => s.label).join(", ")}
                        )
                      </span>
                    ) : null}
                  </>
                }
                amount={`−${fmt.format(selected.income.total)}`}
              />
              <Row
                label="From accounts for spending"
                amount={fmt.format(from.parts.spending)}
                strong
              />
            </div>
            <div
              data-testid="distributions-taxes"
              className="rounded-lg border border-hair border-l-[3px] border-l-data-orange bg-card px-3 py-2.5 text-[13px]"
            >
              <Row
                label="+ Taxes (paid separately)"
                amount={fmt.format(selected.taxes)}
                strong
              />
              <div className="text-[11.5px] text-ink-3">
                Federal + state, spread evenly across the year
              </div>
            </div>
          </div>

          <div className="space-y-2.5">
            <div
              data-testid="distributions-total"
              className="rounded-lg border border-hair bg-card px-3 py-2.5 text-[13px]"
            >
              <Eyebrow>Total from accounts each month</Eyebrow>
              <div className="text-2xl font-semibold tabular text-ink">
                {fmt.format(from.total)}
                {selected.depleted ? (
                  <span aria-label="Accounts exhausted"> †</span>
                ) : null}
              </div>
              <div className="text-[11.5px] text-ink-3">{madeOfText}</div>
              {showUnexplained ? (
                <div data-testid="distributions-unexplained">
                  <Row
                    label="not accounted for"
                    amount={`${from.unexplained < 0 ? "−" : "+"}${fmt.format(Math.abs(from.unexplained))}`}
                    tone="text-crit"
                  />
                </div>
              ) : null}
              <div className="my-1.5 border-t border-hair" />
              {from.accounts.map((a) => (
                <Row
                  key={a.accountId}
                  label={
                    <>
                      {a.name}
                      {a.borrowed > 0 ? (
                        <span className="ml-1 text-[11.5px] text-ink-3">
                          (borrowed on margin)
                        </span>
                      ) : null}
                    </>
                  }
                  amount={fmt.format(a.amount)}
                />
              ))}
              {selected.qcds.map((q) => (
                <div
                  key={q.accountId}
                  className="mt-1 text-[11.5px] text-ink-3"
                >
                  Also from {q.name}: {fmt.format(q.amount)}/mo straight to
                  charity (QCD), not in the totals above
                </div>
              ))}
            </div>

            {selected.goals.length > 0 ? (
              <div
                data-testid="distributions-goals"
                className="rounded-lg border border-dashed border-hair border-l-[3px] border-l-data-purple px-3 py-2.5 text-[13px]"
              >
                <Eyebrow>Goals — paid from set-aside accounts</Eyebrow>
                <div className="mb-1 text-[11.5px] text-ink-3">
                  Not part of the {fmt.format(need.total)} or the{" "}
                  {fmt.format(from.total)}
                </div>
                {selected.goals.map((g) => (
                  <div key={g.goalId}>
                    <Row
                      label={
                        <>
                          {g.name}{" "}
                          <span className="text-ink-3">
                            ← {g.setAsideAccountNames.join(", ")}
                          </span>
                        </>
                      }
                      amount={fmt.format(g.fromSetAside)}
                    />
                    {g.fromGeneral >= MIN_LINE ? (
                      <Row
                        label="from general accounts — included in the account draws above"
                        amount={fmt.format(g.fromGeneral)}
                        indent
                        muted
                      />
                    ) : null}
                    {g.unfunded >= MIN_LINE ? (
                      <Row
                        label={`short by ${fmt.format(g.unfunded)}`}
                        amount=""
                        indent
                        tone="text-crit"
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-hair bg-card">
          <table className="min-w-full text-sm">
            <caption className="sr-only">
              Monthly distributions for every plan year: the spending need,
              income, taxes, what comes from accounts and from each account, and
              goals paid from set-aside accounts
            </caption>
            <thead className="text-xs uppercase text-ink-3">
              <tr>
                <Th align="left">Year</Th>
                <Th align="left">Ages</Th>
                <Th>Spending need</Th>
                <Th>Income</Th>
                <Th>Taxes</Th>
                <Th>From accounts</Th>
                {ranked.map((a) => (
                  <Th key={a.accountId}>{a.name}</Th>
                ))}
                {showOther ? <Th>Other accounts</Th> : null}
                <Th>Goals (set-aside)</Th>
              </tr>
            </thead>
            <tbody className="text-ink">
              {rows.map((r) => {
                const byId = new Map(
                  r.fromAccounts.accounts.map((a) => [a.accountId, a.amount]),
                );
                const other = r.fromAccounts.accounts
                  .filter((a) => !rankedIds.has(a.accountId))
                  .reduce((s, a) => s + a.amount, 0);
                const setAside = r.goals.reduce(
                  (s, g) => s + g.fromSetAside,
                  0,
                );
                return (
                  <tr
                    key={r.year}
                    data-testid={`distributions-row-${r.year}`}
                    onClick={() => onYearClick(r.year)}
                    aria-current={r.year === selected.year ? "true" : undefined}
                    className={`cursor-pointer ${r.year === selected.year ? "bg-accent-wash" : ""}`}
                  >
                    <td className="border-b border-hair px-3 py-2 text-left">
                      <button
                        type="button"
                        title={`Show ${r.year} above`}
                        className="rounded-sm text-ink hover:text-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      >
                        {r.year}
                      </button>
                      {r.depleted ? (
                        <span
                          title="Accounts exhausted — this year's figure is money that does not exist"
                          className="ml-1 font-semibold text-crit"
                        >
                          †
                        </span>
                      ) : null}
                    </td>
                    <Td align="left" tone="text-ink-3">
                      {r.ageLabel}
                    </Td>
                    <Td>{fmt.format(r.need.total)}</Td>
                    <Td>{fmt.format(r.income.total)}</Td>
                    <Td>{fmt.format(r.taxes)}</Td>
                    <Td tone="font-medium text-ink">
                      {fmt.format(r.fromAccounts.total)}
                    </Td>
                    {ranked.map((a) => (
                      <Td key={a.accountId}>{dash(byId.get(a.accountId))}</Td>
                    ))}
                    {showOther ? <Td>{dash(other)}</Td> : null}
                    <Td>{dash(setAside)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  },
);

function dash(amount: number | undefined): string {
  return amount !== undefined && amount >= 0.5 ? fmt.format(amount) : "—";
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-4">
      {children}
    </div>
  );
}

function Row({
  label,
  amount,
  indent,
  strong,
  muted,
  tone,
}: {
  label: React.ReactNode;
  amount: string;
  indent?: boolean;
  strong?: boolean;
  muted?: boolean;
  tone?: string;
}) {
  return (
    <div
      className={`flex justify-between gap-3 py-0.5 ${indent ? "pl-3.5" : ""} ${strong ? "font-semibold" : ""} ${tone ?? (muted ? "text-ink-3" : "text-ink")}`}
    >
      <span>{label}</span>
      <span className="tabular">{amount}</span>
    </div>
  );
}

function Th({
  children,
  align = "right",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
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
      className={`border-b border-hair px-3 py-2 tabular ${align === "left" ? "text-left" : "text-right"} ${tone}`}
    >
      {children}
    </td>
  );
}
