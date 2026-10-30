"use client";

import { memo } from "react";
import {
  selectMonthlyRow,
  type DollarBasis,
  type MonthlyCashFlowRow,
} from "@/lib/solver/monthly-cash-flow";
import {
  hasOtherAccounts,
  rankDistributionAccounts,
  type DistributionRow,
  type MonthlyMode,
} from "@/lib/solver/monthly-distributions";
import {
  DISTRIBUTIONS_DEPLETED_NOTE,
  NOT_ACCOUNTED_FOR,
  distributionCardLines,
  money,
  moneyOrDash,
  signedMoney,
} from "@/lib/solver/distribution-card-lines";
import { MonthlyModeSwitch } from "./solver-monthly-mode-switch";
import { BasisButton } from "./solver-monthly-shared";

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
    const showOther = hasOtherAccounts(rows, ranked);

    const { need, fromAccounts: from } = selected;
    const card = distributionCardLines(selected);

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

        {card.depletedBanner ? (
          <p className="rounded border border-crit/40 bg-crit/10 px-2 py-1.5 text-[11px] text-crit">
            {card.depletedBanner}
          </p>
        ) : null}
        {card.lifeInsuranceNote ? (
          <p className="text-[11.5px] text-ink-3">{card.lifeInsuranceNote}</p>
        ) : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-2.5">
            <div
              data-testid="distributions-need"
              className="rounded-lg border border-hair border-l-[3px] border-l-data-teal bg-card px-3 py-2.5 text-[13px]"
            >
              <Eyebrow>Monthly spending need</Eyebrow>
              <div className="text-2xl font-semibold tabular-nums text-ink">
                {money(need.total)}
              </div>
              <div className="text-[11.5px] text-ink-3">
                Before taxes · not counting goals paid from set-aside accounts
              </div>
              <div className="my-1.5 border-t border-hair" />
              {card.needLines.map((l) => (
                <Row
                  key={l.label}
                  label={l.label}
                  amount={money(l.amount)}
                  indent
                />
              ))}
              <div className="my-1.5 border-t border-hair" />
              <Row
                label={
                  <>
                    {card.coveredByIncome.label}
                    {card.coveredByIncome.sources ? (
                      <span className="text-ink-3">
                        {" "}
                        {card.coveredByIncome.sources}
                      </span>
                    ) : null}
                  </>
                }
                amount={`−${money(selected.income.total)}`}
              />
              <Row
                label="From accounts for spending"
                amount={money(from.parts.spending)}
                strong
              />
            </div>
            <div
              data-testid="distributions-taxes"
              className="rounded-lg border border-hair border-l-[3px] border-l-data-orange bg-card px-3 py-2.5 text-[13px]"
            >
              <Row
                label="+ Taxes (paid separately)"
                amount={money(selected.taxes)}
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
              <div className="text-2xl font-semibold tabular-nums text-ink">
                {money(from.total)}
                {selected.depleted ? (
                  <span aria-label="Accounts exhausted"> †</span>
                ) : null}
              </div>
              <div className="text-[11.5px] text-ink-3">{card.madeOfText}</div>
              {card.unexplained != null ? (
                <div data-testid="distributions-unexplained">
                  <Row
                    label={NOT_ACCOUNTED_FOR}
                    amount={signedMoney(card.unexplained)}
                    tone="text-crit"
                  />
                </div>
              ) : null}
              <div className="my-1.5 border-t border-hair" />
              {card.accounts.map((a) => (
                <Row
                  key={a.accountId}
                  label={
                    <>
                      {a.name}
                      {a.note ? (
                        <span className="ml-1 text-[11.5px] text-ink-3">
                          {a.note}
                        </span>
                      ) : null}
                    </>
                  }
                  amount={money(a.amount)}
                />
              ))}
              {card.qcdNotes.map((note) => (
                <div key={note} className="mt-1 text-[11.5px] text-ink-3">
                  {note}
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
                  {card.goalsCaption}
                </div>
                {card.goals.map((g) => (
                  <div key={g.goalId}>
                    <Row
                      label={
                        <>
                          {g.name}
                          {g.from ? (
                            <span className="text-ink-3"> {g.from}</span>
                          ) : null}
                        </>
                      }
                      amount={g.amount == null ? "" : money(g.amount)}
                    />
                    {g.fromGeneral ? (
                      <Row
                        label={g.fromGeneral.label}
                        amount={money(g.fromGeneral.amount)}
                        indent
                        muted
                      />
                    ) : null}
                    {g.shortBy ? (
                      <Row label={g.shortBy} amount="" indent tone="text-crit" />
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
                          title={DISTRIBUTIONS_DEPLETED_NOTE}
                          className="ml-1 font-semibold text-crit"
                        >
                          †
                        </span>
                      ) : null}
                    </td>
                    <Td align="left" tone="whitespace-nowrap text-ink-3">
                      {r.ageLabel}
                    </Td>
                    <Td>{money(r.need.total)}</Td>
                    <Td>{money(r.income.total)}</Td>
                    <Td>{money(r.taxes)}</Td>
                    <Td tone="font-medium text-ink">
                      {money(r.fromAccounts.total)}
                    </Td>
                    {ranked.map((a) => (
                      <Td key={a.accountId}>
                        {moneyOrDash(byId.get(a.accountId))}
                      </Td>
                    ))}
                    {showOther ? <Td>{moneyOrDash(other)}</Td> : null}
                    <Td>{moneyOrDash(setAside)}</Td>
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
      <span className="tabular-nums">{amount}</span>
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
      className={`border-b border-hair px-3 py-2 tabular-nums ${align === "left" ? "text-left" : "text-right"} ${tone}`}
    >
      {children}
    </td>
  );
}
