// The Distributions view of the Solver's Cash Flow → Monthly report: a retired
// household's monthly spending need, what income covers, what each account
// sends, taxes on top, and goals paid from set-aside accounts in their own box
// (spec 2026-10-30-solver-monthly-distributions-view, "The numbers").
//
// The ONE source of this view's arithmetic. The screen panel, its chart and
// the presentation page all read these rows, so screen and print can't drift.
import type { ClientData, ClientInfo, ProjectionYear } from "@/engine";
import { controllingFamilyMember, normalizeOwners } from "@/engine/ownership";
import { goalDrawAccountIds, isFundedGoal } from "@/engine/goals/goal-funding";
import { ageLabel } from "./cashflow-year-detail";
import {
  deflator,
  householdLiquidAccountIds,
  isDepleted,
  surplusUnspentAnnual,
  type DollarBasis,
} from "./monthly-cash-flow";

export type MonthlyMode = "cashflow" | "distributions";

export interface DistributionAccountLine {
  accountId: string;
  name: string;
  /** supplemental + checking drawdown + RMD cash − set-aside goal draws */
  amount: number;
  /** margin-borrowed part of `amount` (0 when none) */
  borrowed: number;
}

export interface DistributionGoalLine {
  goalId: string;
  name: string;
  setAsideAccountNames: string[];
  /** GoalYear.dedicatedWithdrawal (household, 529 and entity alike) */
  fromSetAside: number;
  /** GoalYear.outOfPocketWithdrawal — inside the account draws */
  fromGeneral: number;
  /** GoalYear.shortfall */
  unfunded: number;
}

export interface DistributionRow {
  year: number;
  ageLabel: string;
  retired: boolean;
  depleted: boolean;
  need: {
    living: number;
    liabilities: number;
    realEstate: number;
    insurance: number;
    /** "Show as a goal" Other rows with no set-aside account — counted in the need. */
    goalLines: { expenseId: string; name: string; amount: number }[];
    other: number;
    savings: number;
    total: number;
  };
  income: { total: number; sources: { label: string; amount: number }[] };
  taxes: number;
  fromAccounts: {
    total: number;
    /** largest first; real lines only (amount ≥ `MIN_LINE_PER_MONTH`). `total` is their sum. */
    accounts: DistributionAccountLine[];
    parts: {
      spending: number;
      taxes: number;
      goalShortfall: number;
      surplusSpent: number;
      absorbedExtra: number;
      keptOrReinvested: number;
    };
    unexplained: number;
  };
  /** goals with goalExpense > 0 */
  goals: DistributionGoalLine[];
  qcds: { accountId: string; name: string; amount: number }[];
}

const MONTHS_PER_YEAR = 12;

/** The smallest account line worth a row, per month: anything less prints as "$0". */
const MIN_LINE_PER_MONTH = 0.5;

/** The engine's own age of death when no life expectancy is set
 *  (`computeFirstDeathYear`'s `?? 95`). */
const ASSUMED_LIFE_EXPECTANCY = 95;

const NO_DETAIL: NonNullable<ProjectionYear["distributionDetail"]> = {
  rmdInTotalIncome: 0,
  goalDrawsByAccount: {},
  absorbedSurplus: 0,
};

/**
 * Every living household member has reached their retirement age this year.
 *
 * "Living" is checked against life expectancy as well as presence: the engine
 * keeps `ages.spouse` (and the client's age) counting after a death, so a
 * survivor year would otherwise wait forever on a spouse who died before
 * retiring. A member with no retirement age has nothing to wait for.
 */
export function isRetirementYear(year: ProjectionYear, client: ClientInfo): boolean {
  const members = [
    { age: year.ages.client, retireAt: client.retirementAge, diesAt: client.lifeExpectancy },
    {
      age: year.ages.spouse,
      retireAt: client.spouseRetirementAge,
      diesAt: client.spouseLifeExpectancy,
    },
  ];
  return members.every(
    ({ age, retireAt, diesAt }) =>
      age == null ||
      age > (diesAt ?? ASSUMED_LIFE_EXPECTANCY) ||
      retireAt == null ||
      age >= retireAt,
  );
}

/** At most this many accounts get their own column / colour. */
const MAX_RANKED_ACCOUNTS = 4;

/** The accounts that get their own column/colour: largest Σ amount across
 *  `rows` first, at most four; everything else is "Other accounts". */
export function rankDistributionAccounts(
  rows: DistributionRow[],
): { accountId: string; name: string }[] {
  const totals = new Map<string, { accountId: string; name: string; total: number }>();
  for (const r of rows) {
    for (const a of r.fromAccounts.accounts) {
      const t = totals.get(a.accountId) ?? { accountId: a.accountId, name: a.name, total: 0 };
      t.total += a.amount;
      totals.set(a.accountId, t);
    }
  }
  return [...totals.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_RANKED_ACCOUNTS)
    .map(({ accountId, name }) => ({ accountId, name }));
}

const sumOf = <T>(xs: readonly T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

export function buildMonthlyDistributionRows(
  years: ProjectionYear[],
  clientData: ClientData,
  basis: DollarBasis = "today",
): DistributionRow[] {
  const householdLiquidIds = householdLiquidAccountIds(years, clientData);

  const knownAccounts = [
    ...clientData.accounts,
    ...years.flatMap((y) => y.syntheticAccounts ?? []),
  ];
  const accountName = new Map(knownAccounts.map((a) => [a.id, a.name]));
  const nameOf = (id: string) => accountName.get(id) ?? id;
  // Whose RMD cash reached household checking — the engine's own routing
  // predicate, read through `normalizeOwners` because the engine does. An
  // entity-owned IRA carries `rmdAmount` too, but its cash goes to the
  // entity, never into `rmdInTotalIncome`.
  const householdIds = new Set(
    knownAccounts
      .filter((a) => controllingFamilyMember(normalizeOwners(a)) != null)
      .map((a) => a.id),
  );

  const accountById = new Map(clientData.accounts.map((a) => [a.id, a]));
  const expenseById = new Map(clientData.expenses.map((e) => [e.id, e]));
  // "Show as a goal" Other rows the engine pays as a plain expense: no
  // set-aside account to draw, and no owner entity/account paying it.
  const unsetAsideGoals = clientData.expenses.filter(
    (e) =>
      e.type === "other" &&
      e.isGoal === true &&
      !isFundedGoal(e, accountById) &&
      e.ownerAccountId == null &&
      e.ownerEntityId == null,
  );

  return years.map((y) => {
    // One scale factor per year: annual → monthly, then nominal → chosen basis.
    const k = deflator(y.year, basis, clientData.planSettings) / MONTHS_PER_YEAR;
    const detail = y.distributionDetail ?? NO_DETAIL;

    // ── Goals ──
    const setAsideGoals = (y.goals ?? []).filter((g) => !g.accumulation);
    // The household-paid part sits inside `expenses.other`; a 529 or entity
    // draw never touched household money and is not there (R2).
    const setAsideHouseholdCost = sumOf(
      setAsideGoals,
      (g) => g.householdWithdrawal + g.outOfPocketWithdrawal,
    );
    const outOfPocket = sumOf(setAsideGoals, (g) => g.outOfPocketWithdrawal);
    const goals: DistributionGoalLine[] = setAsideGoals
      .filter((g) => g.goalExpense > 0)
      .map((g) => {
        const expense = expenseById.get(g.goalId);
        return {
          goalId: g.goalId,
          name: expense?.name ?? g.goalId,
          setAsideAccountNames: expense
            ? goalDrawAccountIds(expense, accountById).map(nameOf)
            : [],
          fromSetAside: g.dedicatedWithdrawal * k,
          fromGeneral: g.outOfPocketWithdrawal * k,
          unfunded: g.shortfall * k,
        };
      });

    // ── Spending need (annual) ──
    const goalLinesAnnual = unsetAsideGoals
      .map((e) => ({ expenseId: e.id, name: e.name, amount: y.expenses.bySource[e.id] ?? 0 }))
      .filter((l) => l.amount > 0);
    const goalLinesTotal = sumOf(goalLinesAnnual, (l) => l.amount);
    const living = y.expenses.living - detail.absorbedSurplus;
    const other = y.expenses.other - setAsideHouseholdCost - goalLinesTotal;
    const needTotal =
      living +
      y.expenses.liabilities +
      y.expenses.realEstate +
      y.expenses.insurance +
      goalLinesTotal +
      other +
      y.savings.total;

    // ── Income (annual): RMD cash moves to the account it came from ──
    const incomeTotal = y.totalIncome - detail.rmdInTotalIncome;
    const named = [
      { label: "Social Security", amount: y.income.socialSecurity },
      { label: "Salary", amount: y.income.salaries },
      { label: "Pension / deferred comp", amount: y.income.deferred },
      { label: "Business", amount: y.income.business },
      { label: "Trust", amount: y.income.trust },
    ].filter((s) => s.amount !== 0);
    const otherIncome = incomeTotal - sumOf(named, (s) => s.amount);
    const sources = [
      ...named,
      ...(otherIncome * k >= 1 ? [{ label: "Other income", amount: otherIncome }] : []),
    ].map((s) => ({ label: s.label, amount: s.amount * k }));

    // ── Account draws (annual) ──
    const rmdById = new Map<string, number>();
    for (const [id, ledger] of Object.entries(y.accountLedgers)) {
      if (ledger.rmdAmount > 0 && householdIds.has(id)) rmdById.set(id, ledger.rmdAmount);
    }
    const accountIds = new Set([...Object.keys(y.withdrawals.byAccount), ...rmdById.keys()]);
    const accounts: DistributionAccountLine[] = [...accountIds]
      .map((id) => ({
        accountId: id,
        name: nameOf(id),
        amount:
          ((y.withdrawals.byAccount[id] ?? 0) -
            (detail.goalDrawsByAccount[id] ?? 0) +
            (rmdById.get(id) ?? 0)) *
          k,
        borrowed: (y.withdrawals.borrowedByAccount?.[id] ?? 0) * k,
      }))
      // A line at or below zero — or float dust that would print as "$0"; the
      // engine leaves ~1e-12 on checking in some years — is dropped from the
      // list AND the total. Whatever it carried surfaces in `unexplained`,
      // never in another figure.
      .filter((a) => a.amount >= MIN_LINE_PER_MONTH)
      .sort((a, b) => b.amount - a.amount);
    const fromAccountsTotal = sumOf(accounts, (a) => a.amount);

    // ── What the account money paid for: income is used up in this order ──
    const taxes = y.expenses.taxes;
    const discretionary = y.expenses.discretionary;
    const kept = surplusUnspentAnnual(y);
    let left = incomeTotal;
    const take = (use: number) => {
      const fromAccts = Math.max(0, use - left);
      left = Math.max(0, left - use);
      return fromAccts * k;
    };
    const parts = {
      spending: take(needTotal),
      taxes: take(taxes),
      goalShortfall: take(outOfPocket),
      surplusSpent: take(discretionary),
      absorbedExtra: take(detail.absorbedSurplus),
      keptOrReinvested: take(kept),
    };
    const unexplained =
      incomeTotal * k +
      fromAccountsTotal -
      (needTotal + taxes + outOfPocket + discretionary + detail.absorbedSurplus + kept) * k;

    // ── QCDs: a note under the IRA, outside every total ──
    const qcds = Object.entries(y.accountLedgers)
      .filter(([id]) => householdIds.has(id))
      .map(([id, ledger]) => ({
        accountId: id,
        name: nameOf(id),
        amount: -sumOf(
          ledger.entries.filter((e) => e.category === "qcd"),
          (e) => e.amount,
        ) * k,
      }))
      .filter((q) => q.amount > 0);

    return {
      year: y.year,
      ageLabel: ageLabel(y),
      retired: isRetirementYear(y, clientData.client),
      depleted: isDepleted(y, householdLiquidIds),
      need: {
        living: living * k,
        liabilities: y.expenses.liabilities * k,
        realEstate: y.expenses.realEstate * k,
        insurance: y.expenses.insurance * k,
        goalLines: goalLinesAnnual.map((l) => ({ ...l, amount: l.amount * k })),
        other: other * k,
        savings: y.savings.total * k,
        total: needTotal * k,
      },
      income: { total: incomeTotal * k, sources },
      taxes: taxes * k,
      fromAccounts: { total: fromAccountsTotal, accounts, parts, unexplained },
      goals,
      qcds,
    };
  });
}
