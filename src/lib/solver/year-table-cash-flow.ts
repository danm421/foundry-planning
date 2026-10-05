// One year of the Solver cash-flow table, built so every row ties out by eye:
//
//   Total In − Total Out = Surplus / (Shortfall)
//
// Both totals are the engine's own (`totalIncome` + supplemental withdrawals,
// and `totalExpenses`). The named columns are carved out of them and "Other
// Income" / "Other Expenses" take what's left, so nothing the engine counts can
// fall out of the row and nothing it doesn't count can sneak in.
import type { ClientData, ProjectionYear } from "@/engine";
import { householdRmdItems } from "./cashflow-year-detail";

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
