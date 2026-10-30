// The Distributions view of the Solver's Cash Flow → Monthly report: a retired
// household's monthly spending need, what income covers, what each account
// sends, taxes on top, and goals paid from set-aside accounts in their own box
// (spec 2026-10-30-solver-monthly-distributions-view, "The numbers").
//
// The ONE source of this view's arithmetic. The screen panel, its chart and
// the presentation page all read these rows, so screen and print can't drift.
import type { ClientData, ClientInfo, ProjectionYear } from "@/engine";
import type { GoalYear } from "@/engine/types";
import { canHaveGoalFunding, goalDrawAccountIds } from "@/engine/goals/goal-funding";
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
  /** The same draw for the whole year in future dollars — what
   *  `rankDistributionAccounts` sums, so the column order is one order in both
   *  dollar bases, on screen and in print. */
  annualNominal: number;
  /** margin-borrowed part of `amount` (0 when none) */
  borrowed: number;
}

export interface DistributionGoalLine {
  goalId: string;
  name: string;
  /** Empty only for a goal with no set-aside account, listed here solely for
   *  its unfunded part — what it did cost is a need line (R14). */
  setAsideAccountNames: string[];
  /** GoalYear.dedicatedWithdrawal (household, 529 and entity alike) */
  fromSetAside: number;
  /** The household-paid out-of-pocket part — inside the account draws. An
   *  entity's out-of-pocket part (paid by its own checking) is never here. */
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
    /** Goals with no set-aside account — counted in the need (R14): a "Show as
     *  a goal" Other row, or an education goal with no 529, at its booked cost. */
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
  /** Set-aside goals with a cost this year, plus any goal with no set-aside
   *  account that went partly unfunded (shown only for its "short by"). */
  goals: DistributionGoalLine[];
  qcds: { accountId: string; name: string; amount: number }[];
  /** Life insurance paid out this year — the WHOLE YEAR'S lump sum in the
   *  chosen dollar basis, not a monthly figure. Kept out of income and every
   *  other figure: the engine adds it to the year's income after the cash
   *  flows ran, so it pays for nothing in them. 0 in most years. */
  lifeInsuranceProceeds: number;
}

const MONTHS_PER_YEAR = 12;

/** Never printed in practice — every id a projection lists is named by the
 *  plan or the engine — but a raw id must never reach a client page. */
const UNNAMED_ACCOUNT = "Unnamed account";

/** The view's ONE threshold set, per month. A line below `MIN_LINE_PER_MONTH`
 *  would print as "$0" (or is float dust — the engine leaves ~1e-12 on
 *  checking), so it is left off. The leftover gets its own line from
 *  `MIN_UNEXPLAINED_PER_MONTH`, the spec's "above $1/month". */
export const MIN_LINE_PER_MONTH = 0.5;
export const MIN_UNEXPLAINED_PER_MONTH = 1;

/** The engine's own age of death when no life expectancy is set
 *  (`computeFirstDeathYear`'s `?? 95`). */
const ASSUMED_LIFE_EXPECTANCY = 95;

const NO_DETAIL: NonNullable<ProjectionYear["distributionDetail"]> = {
  rmdInTotalIncome: 0,
  rmdCashByAccount: {},
  goalDrawsByAccount: {},
  absorbedSurplus: 0,
  mintedAccountNames: {},
};

/**
 * The household members alive this year, client first.
 *
 * Checked against life expectancy as well as presence: the engine keeps
 * `ages.spouse` (and the client's age) counting after a death. A member is
 * still alive in their death year (age === life expectancy).
 */
function livingMembers(
  year: ProjectionYear,
  client: ClientInfo,
): { age: number; retireAt: number | undefined }[] {
  const members = [
    { age: year.ages.client, retireAt: client.retirementAge, diesAt: client.lifeExpectancy },
    {
      age: year.ages.spouse,
      retireAt: client.spouseRetirementAge,
      diesAt: client.spouseLifeExpectancy,
    },
  ];
  return members.flatMap(({ age, retireAt, diesAt }) =>
    age != null && age <= (diesAt ?? ASSUMED_LIFE_EXPECTANCY) ? [{ age, retireAt }] : [],
  );
}

/**
 * Every living household member has reached their retirement age this year.
 * A survivor year doesn't wait on a spouse who died before retiring, and a
 * member with no retirement age has nothing to wait for.
 */
export function isRetirementYear(year: ProjectionYear, client: ClientInfo): boolean {
  return livingMembers(year, client).every(
    ({ age, retireAt }) => retireAt == null || age >= retireAt,
  );
}

/** `ageLabel`'s format, listing only the living members: "Age 79" in a
 *  survivor year, not the deceased's still-counting age beside it. */
function livingAgeLabel(year: ProjectionYear, client: ClientInfo): string {
  const living = livingMembers(year, client);
  return living.length > 0 ? `Age ${living.map((m) => m.age).join(" / ")}` : ageLabel(year);
}

/** At most this many accounts get their own column / colour. */
const MAX_RANKED_ACCOUNTS = 4;

/** True when some row draws from an account `ranked` leaves out — the "Other
 *  accounts" column / stack shows. */
export function hasOtherAccounts(
  rows: DistributionRow[],
  ranked: { accountId: string }[],
): boolean {
  const ids = new Set(ranked.map((a) => a.accountId));
  return rows.some((r) => r.fromAccounts.accounts.some((a) => !ids.has(a.accountId)));
}

/** The accounts that get their own column/colour: largest total draw across
 *  `rows` first, at most four; everything else is "Other accounts". Pass the
 *  FULL projection's rows and the order is the same on screen and in print.
 *  Sums `annualNominal`, so the dollar basis can't reorder the columns. */
export function rankDistributionAccounts(
  rows: DistributionRow[],
): { accountId: string; name: string }[] {
  const totals = new Map<string, { accountId: string; name: string; total: number }>();
  for (const r of rows) {
    for (const a of r.fromAccounts.accounts) {
      const t = totals.get(a.accountId) ?? { accountId: a.accountId, name: a.name, total: 0 };
      t.total += a.annualNominal;
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

  // Names for every account a row can list: the plan's own, then any the
  // engine minted (a death splitting an IRA between heirs, equity destination
  // accounts) — a minted account keeps its name in every year it exists.
  const accountName = new Map(clientData.accounts.map((a) => [a.id, a.name]));
  for (const y of years) {
    for (const [id, name] of Object.entries(y.distributionDetail?.mintedAccountNames ?? {})) {
      if (!accountName.has(id)) accountName.set(id, name);
    }
  }
  const nameOf = (id: string) => accountName.get(id) ?? UNNAMED_ACCOUNT;

  const accountById = new Map(clientData.accounts.map((a) => [a.id, a]));
  const expenseById = new Map(clientData.expenses.map((e) => [e.id, e]));
  // R14: a goal is "set-aside" only when it has an account to draw. Every
  // other goal — a "Show as a goal" Other row with no account, or an education
  // goal with no 529 — counts in the need at what the household paid for it
  // (an entity or business owner pays its own goals, so those never do).
  const hasSetAside = (expenseId: string) => {
    const e = expenseById.get(expenseId);
    return e != null && goalDrawAccountIds(e, accountById).length > 0;
  };
  const needGoalExpenses = clientData.expenses.filter(
    (e) =>
      canHaveGoalFunding(e) &&
      !hasSetAside(e.id) &&
      e.ownerAccountId == null &&
      e.ownerEntityId == null,
  );

  return years.map((y) => {
    // One scale factor per year: nominal → chosen basis, then annual → monthly.
    const toBasis = deflator(y.year, basis, clientData.planSettings);
    const k = toBasis / MONTHS_PER_YEAR;
    const detail = y.distributionDetail ?? NO_DETAIL;

    // ── Goals ──
    const goalYears = (y.goals ?? []).filter((g) => !g.accumulation);
    const setAsideGoals = goalYears.filter((g) => hasSetAside(g.goalId));
    // The household-paid cost is exactly what the engine booked into
    // `expenses.other` under the goal's id — NOT `householdWithdrawal +
    // outOfPocketWithdrawal`. The engine sets `outOfPocketWithdrawal` whenever
    // the option is on, but books it only for a household-owned goal with a
    // checking account to pay from: an entity-owned goal's gap is paid by the
    // entity's own checking, and with no default checking nothing pays it.
    // A 529 or entity draw never touched household money either (R2, R7).
    const householdCost = (g: GoalYear) => y.expenses.bySource[g.goalId] ?? 0;
    // The part of that cost paid from household cash flow, i.e. inside the
    // account draws above — never an entity's out-of-pocket part.
    const householdOutOfPocket = (g: GoalYear) =>
      Math.max(0, householdCost(g) - g.householdWithdrawal);
    const setAsideHouseholdCost = sumOf(setAsideGoals, householdCost);
    const outOfPocket = sumOf(setAsideGoals, householdOutOfPocket);
    const goalLine = (g: GoalYear, setAside: boolean): DistributionGoalLine => {
      const expense = expenseById.get(g.goalId);
      return {
        goalId: g.goalId,
        name: expense?.name ?? g.goalId,
        setAsideAccountNames:
          setAside && expense ? goalDrawAccountIds(expense, accountById).map(nameOf) : [],
        fromSetAside: g.dedicatedWithdrawal * k,
        fromGeneral: setAside ? householdOutOfPocket(g) * k : 0,
        unfunded: g.shortfall * k,
      };
    };
    const goals: DistributionGoalLine[] = [
      ...setAsideGoals.filter((g) => g.goalExpense > 0).map((g) => goalLine(g, true)),
      // No set-aside account: what it cost is a need line; only an unfunded
      // part has a place here, as "short by" (R14).
      ...goalYears
        .filter((g) => !hasSetAside(g.goalId) && g.shortfall * k >= MIN_LINE_PER_MONTH)
        .map((g) => goalLine(g, false)),
    ];

    // ── Spending need (annual) ──
    const goalLinesAnnual = needGoalExpenses
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
    const bySourcePrefix = (prefix: string) =>
      sumOf(
        Object.entries(y.income.bySource).filter(([key]) => key.startsWith(prefix)),
        ([, amount]) => amount,
      );
    // Life insurance proceeds are folded into the year's income AFTER its cash
    // flows ran (`foldLifeInsurancePayoutsIntoIncome`), so they paid for none
    // of it: left in, they would cover the whole need and leave the real draws
    // unexplained. The row carries them as a note instead.
    const lifeInsurance = bySourcePrefix("life-insurance-proceeds:");
    const incomeTotal = y.totalIncome - detail.rmdInTotalIncome - lifeInsurance;
    const named = [
      { label: "Social Security", amount: y.income.socialSecurity },
      { label: "Salary", amount: y.income.salaries },
      { label: "Pension / deferred comp", amount: y.income.deferred },
      // Inside `income.other`; the engine keys each contract `annuity:<id>`.
      { label: "Annuity", amount: bySourcePrefix("annuity:") },
      { label: "Business", amount: y.income.business },
      { label: "Trust", amount: y.income.trust },
    ].filter((s) => s.amount !== 0);
    const otherIncome = incomeTotal - sumOf(named, (s) => s.amount);
    const sources = [
      ...named,
      ...(otherIncome * k >= MIN_LINE_PER_MONTH ? [{ label: "Other income", amount: otherIncome }] : []),
    ].map((s) => ({ label: s.label, amount: s.amount * k }));

    // ── Account draws (annual) ──
    // RMD cash as the engine routed it THIS year: by the working owners a
    // death may have rewritten (a split IRA's minted shares are in it; an IRA
    // left to a trust is not), and never an entity-owned IRA's.
    const rmdById = detail.rmdCashByAccount;
    const accountIds = new Set([
      ...Object.keys(y.withdrawals.byAccount),
      ...Object.keys(rmdById),
    ]);
    const accounts: DistributionAccountLine[] = [...accountIds]
      .map((id) => {
        const annual =
          (y.withdrawals.byAccount[id] ?? 0) -
          (detail.goalDrawsByAccount[id] ?? 0) +
          (rmdById[id] ?? 0);
        return {
          accountId: id,
          name: nameOf(id),
          amount: annual * k,
          annualNominal: annual,
          borrowed: (y.withdrawals.borrowedByAccount?.[id] ?? 0) * k,
        };
      })
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
    // No ownership filter: the engine books a QCD only from an IRA whose sole
    // owner that year is the client or the spouse (`qcdGiverOf`; an entity or
    // other heir gives none) — a death's minted share included. Not keyed on
    // `rmdCashByAccount` either: a QCD that pays the whole RMD leaves no RMD
    // cash, and that is the most common QCD of all.
    const qcds = Object.entries(y.accountLedgers)
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
      ageLabel: livingAgeLabel(y, clientData.client),
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
      lifeInsuranceProceeds: lifeInsurance * toBasis,
    };
  });
}
