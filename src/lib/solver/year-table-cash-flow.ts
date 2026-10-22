// One year of the Solver cash-flow table, built so every row ties out by eye:
//
//   Total In − Total Out = Surplus / (Shortfall)
//
// Both totals are the engine's own (`totalIncome` + supplemental withdrawals,
// and `totalExpenses`). The named columns are carved out of them and "Other
// Income" / "Other Expenses" take what's left, so nothing the engine counts can
// fall out of the row and nothing it doesn't count can sneak in.
import type { ClientData, ProjectionYear } from "@/engine";
import { isMaterialShortfall } from "@/lib/retirement/retirement-inflows";
import { householdRmdItems } from "./cashflow-year-detail";
import type { YearDrillColumnKey } from "./year-cell-drill";

export interface YearCashFlow {
  socialSecurity: number;
  salaries: number;
  /** The rest of totalIncome — pensions, business and trust income, annuities,
   *  note payments, sale proceeds. */
  otherIncome: number;
  /** Household-owned accounts only; an entity's RMD lands in the entity's checking. */
  rmds: number;
  withdrawals: number;
  totalIn: number;
  living: number;
  taxes: number;
  /** Debt payments, insurance, property tax, gifts, education, surplus spent, other. */
  otherExpenses: number;
  /** Planned contributions plus any Solver hypothetical savings. */
  savings: number;
  totalOut: number;
  /** Positive: left over and kept in the portfolio. Negative: spending nothing covered. */
  net: number;
}

// Every column of every row reads this, so each year is built once per
// (clientData, year) pair — both refs are replaced on a new projection run.
const cache = new WeakMap<ClientData, WeakMap<ProjectionYear, YearCashFlow>>();

export function yearCashFlow(year: ProjectionYear, clientData: ClientData): YearCashFlow {
  let byYear = cache.get(clientData);
  if (!byYear) cache.set(clientData, (byYear = new WeakMap()));
  let cf = byYear.get(year);
  if (!cf) byYear.set(year, (cf = compute(year, clientData)));
  return cf;
}

function compute(year: ProjectionYear, clientData: ClientData): YearCashFlow {
  const socialSecurity = year.income.socialSecurity;
  const salaries = year.income.salaries;
  const rmds = householdRmdItems(year, clientData, {}).reduce((s, i) => s + i.amount, 0);
  const withdrawals = year.withdrawals.total;
  const totalIn = year.totalIncome + withdrawals;
  const living = year.expenses.living;
  const taxes = year.expenses.taxes;
  const savings = year.savings.total + (year.hypotheticalSavings?.contribution ?? 0);
  const totalOut = year.totalExpenses;
  return {
    socialSecurity,
    salaries,
    otherIncome: year.totalIncome - socialSecurity - salaries - rmds,
    rmds,
    withdrawals,
    totalIn,
    living,
    taxes,
    // The catch-all: anything totalExpenses gains beyond these lands here (and
    // in its drill's balancing row), never inside Savings.
    otherExpenses: totalOut - living - taxes - savings,
    savings,
    totalOut,
    net: totalIn - totalOut,
  };
}

export interface CashFlowColumn {
  key: YearDrillColumnKey;
  header: string;
  group?: "Cash In" | "Cash Out";
  tooltip?: string;
  value: (cf: YearCashFlow) => number;
  tone?: (cf: YearCashFlow) => "default" | "crit";
  /** Totals and the net always show; a component column that is $0 in every
   *  year (Salaries for a retired couple) hides itself. */
  alwaysShow?: boolean;
}

// The money columns of the Solver's Cash Flow table, shared by the screen and
// its printed sheet so the two can't disagree on what a column holds.
// Every row ties out: Total In − Total Out = Surplus / (Shortfall).
const CASH_FLOW_COLUMNS: CashFlowColumn[] = [
  { key: "socialSecurity", header: "Social Security", group: "Cash In", value: (cf) => cf.socialSecurity },
  { key: "salaries", header: "Salaries", group: "Cash In", value: (cf) => cf.salaries },
  {
    key: "otherIncome",
    header: "Other Income",
    group: "Cash In",
    tooltip: "Pensions, business and trust income, annuities, note payments, and sale proceeds.",
    value: (cf) => cf.otherIncome,
  },
  { key: "rmds", header: "RMDs", group: "Cash In", value: (cf) => cf.rmds },
  { key: "withdrawals", header: "Withdrawals", group: "Cash In", value: (cf) => cf.withdrawals },
  { key: "totalIn", header: "Total In", group: "Cash In", value: (cf) => cf.totalIn, alwaysShow: true },
  { key: "livingExpenses", header: "Living Expenses", group: "Cash Out", value: (cf) => cf.living },
  { key: "taxes", header: "Taxes", group: "Cash Out", value: (cf) => cf.taxes },
  {
    key: "otherExpenses",
    header: "Other Expenses",
    group: "Cash Out",
    tooltip: "Debt payments, insurance premiums, property tax, gifts, and any other planned expenses.",
    value: (cf) => cf.otherExpenses,
  },
  { key: "savings", header: "Savings", group: "Cash Out", value: (cf) => cf.savings },
  { key: "totalOut", header: "Total Out", group: "Cash Out", value: (cf) => cf.totalOut, alwaysShow: true },
  {
    key: "net",
    header: "Surplus / (Shortfall)",
    tooltip: "Total In minus Total Out. A surplus stays in the portfolio; a shortfall is spending nothing could cover.",
    value: (cf) => cf.net,
    tone: (cf) => (isMaterialShortfall(-cf.net) ? "crit" : "default"),
    alwaysShow: true,
  },
];

/** The columns this plan shows. Decide over the FULL projection, so every year
 *  range of one plan shows the same columns. */
export function visibleCashFlowColumns(
  years: ProjectionYear[],
  clientData: ClientData,
): CashFlowColumn[] {
  return CASH_FLOW_COLUMNS.filter(
    (col) =>
      col.alwaysShow ||
      years.some((row) => Math.round(col.value(yearCashFlow(row, clientData))) !== 0),
  );
}
