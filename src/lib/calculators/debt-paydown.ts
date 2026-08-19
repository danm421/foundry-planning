/**
 * Debt paydown simulator for the client portal's calculator.
 *
 * Pure — no `@/db`, no `next/*`, no React — so it runs identically in a route
 * handler, in the browser between keystrokes, and in plain vitest. It lives
 * beside `@/lib/loan-math` (which holds the closed-form amortization
 * primitives) rather than in `src/engine/`: this is a what-if the client runs
 * for themselves, and it must never become a dependency of the projection.
 *
 * The whole model is one monthly loop. What makes the three strategies differ
 * is the POOL: every dollar freed by a debt that has already been cleared is
 * added to the next debt's payment. Without that rolling, avalanche, snowball
 * and equally would all produce the same schedule.
 */

export type PaydownStrategy = "avalanche" | "snowball" | "equally";

export interface PaydownDebt {
  id: string;
  name: string;
  balance: number;
  /** Annual FRACTION — 0.0649 is 6.49%, matching liabilities.interest_rate. */
  annualRate: number;
  /** The required monthly payment. A debt without one is never simulated. */
  minimumPayment: number;
}

export interface PaydownOptions {
  strategy: PaydownStrategy;
  extraMonthly: number;
  /** Calendar year the first payment lands in. */
  startYear: number;
  /** 1-12. */
  startMonth: number;
  /**
   * `false` turns off both the extra payment and the rolling pool, giving the
   * "minimums, paid separately" baseline. Defaults to `true`.
   */
  roll?: boolean;
}

export interface PaydownDebtResult {
  id: string;
  name: string;
  /** Months from today, 1-based: 1 means cleared this month. Null if never. */
  payoffMonth: number | null;
  totalInterest: number;
}

export interface PaydownYearRow {
  year: number;
  payment: number;
  principal: number;
  interest: number;
  endingBalance: number;
  /** How many debts still had a balance at some point during the year. */
  activeDebts: number;
}

export interface PaydownRun {
  monthsToDebtFree: number;
  totalInterest: number;
  /** Total balance at the end of each month; index 0 is today's balance. */
  balanceSeries: number[];
  perDebt: PaydownDebtResult[];
  yearly: PaydownYearRow[];
  /** True when the ceiling was reached with a balance still owing. */
  neverPaysOff: boolean;
  stalledDebtIds: string[];
}

/** 50 years — the same ceiling `@/lib/portal/loan-details` uses for a loan. */
export const MAX_PAYDOWN_MONTHS = 600;

/** Below half a cent a balance is paid. Keeps float dust out of the results. */
const PAID = 0.005;

interface Live {
  debt: PaydownDebt;
  balance: number;
  interest: number;
  payoffMonth: number | null;
}

function totalBalance(live: Live[]): number {
  return live.reduce((sum, l) => sum + l.balance, 0);
}

/**
 * The debts the pool attacks, in the order it attacks them. Ties are broken
 * all the way down to the name so a run is reproducible — two debts at the
 * same rate must not swap places between renders.
 */
function orderFor(live: Live[], strategy: PaydownStrategy): Live[] {
  const open = live.filter((l) => l.balance > PAID);
  if (strategy === "avalanche") {
    return open.sort(
      (a, b) =>
        b.debt.annualRate - a.debt.annualRate ||
        a.balance - b.balance ||
        a.debt.name.localeCompare(b.debt.name),
    );
  }
  if (strategy === "snowball") {
    return open.sort(
      (a, b) =>
        a.balance - b.balance ||
        b.debt.annualRate - a.debt.annualRate ||
        a.debt.name.localeCompare(b.debt.name),
    );
  }
  return open;
}

/** Spends `pool` across `open`, mutating balances. Returns the amount paid. */
function spendPool(open: Live[], pool: number, strategy: PaydownStrategy): number {
  let left = pool;

  if (strategy === "equally") {
    let targets = open.filter((l) => l.balance > PAID);
    // Each pass hands out everything left, so this terminates on its own; the
    // pass cap is a guard against a float that never quite reaches zero.
    for (let pass = 0; pass <= open.length && left > PAID && targets.length > 0; pass++) {
      const share = left / targets.length;
      const next: Live[] = [];
      for (const l of targets) {
        const pay = Math.min(share, l.balance);
        l.balance -= pay;
        left -= pay;
        if (l.balance > PAID) next.push(l);
      }
      targets = next;
    }
    return pool - left;
  }

  for (const l of open) {
    if (left <= PAID) break;
    const pay = Math.min(left, l.balance);
    l.balance -= pay;
    left -= pay;
  }
  return pool - left;
}

export function simulatePaydown(
  debts: PaydownDebt[],
  opts: PaydownOptions,
): PaydownRun {
  const rolling = opts.roll !== false;
  const extra = rolling ? Math.max(0, opts.extraMonthly) : 0;

  const live: Live[] = debts.map((d) => ({
    debt: d,
    balance: Math.max(0, d.balance),
    interest: 0,
    payoffMonth: null,
  }));

  const balanceSeries: number[] = [totalBalance(live)];
  const yearly: PaydownYearRow[] = [];
  let totalInterest = 0;
  let month = 0;

  let year = opts.startYear;
  let monthOfYear = opts.startMonth;
  let yPayment = 0;
  let yPrincipal = 0;
  let yInterest = 0;
  let yActive = 0;

  while (month < MAX_PAYDOWN_MONTHS && totalBalance(live) > PAID) {
    month++;
    yActive = Math.max(yActive, live.filter((l) => l.balance > PAID).length);

    // 1. Accrue this month's interest onto every open balance.
    let monthInterest = 0;
    for (const l of live) {
      if (l.balance <= PAID) continue;
      const accrued = l.balance * (l.debt.annualRate / 12);
      l.balance += accrued;
      l.interest += accrued;
      monthInterest += accrued;
    }

    // 2. Pay the minimums, and build the pool as we go. A debt cleared in an
    //    earlier month frees its whole payment; one whose minimum overshoots
    //    its remaining balance frees the unused remainder this month.
    let pool = extra;
    let monthPaid = 0;
    for (const l of live) {
      if (l.balance <= PAID) {
        if (rolling) pool += l.debt.minimumPayment;
        continue;
      }
      const pay = Math.min(l.debt.minimumPayment, l.balance);
      l.balance -= pay;
      monthPaid += pay;
      if (rolling) pool += l.debt.minimumPayment - pay;
    }

    // 3. Spend the pool on whatever is still open, per strategy.
    if (rolling && pool > PAID) {
      monthPaid += spendPool(orderFor(live, opts.strategy), pool, opts.strategy);
    }

    // 4. Settle: zero the dust so the series ends on a clean 0, and stamp the
    //    payoff month the first time a debt clears.
    for (const l of live) {
      if (l.balance <= PAID && l.payoffMonth === null) {
        l.balance = 0;
        l.payoffMonth = month;
      }
    }

    totalInterest += monthInterest;
    balanceSeries.push(totalBalance(live));

    yInterest += monthInterest;
    yPayment += monthPaid;
    yPrincipal += monthPaid - monthInterest;

    const done = totalBalance(live) <= PAID;
    if (monthOfYear === 12 || done || month === MAX_PAYDOWN_MONTHS) {
      yearly.push({
        year,
        payment: yPayment,
        principal: yPrincipal,
        interest: yInterest,
        endingBalance: totalBalance(live),
        activeDebts: yActive,
      });
      yPayment = 0;
      yPrincipal = 0;
      yInterest = 0;
      yActive = 0;
    }
    if (monthOfYear === 12) {
      monthOfYear = 1;
      year++;
    } else {
      monthOfYear++;
    }
  }

  const stalled = live.filter((l) => l.balance > PAID);
  return {
    monthsToDebtFree: month,
    totalInterest,
    balanceSeries,
    perDebt: live.map((l) => ({
      id: l.debt.id,
      name: l.debt.name,
      payoffMonth: l.payoffMonth,
      totalInterest: l.interest,
    })),
    yearly,
    neverPaysOff: stalled.length > 0,
    stalledDebtIds: stalled.map((l) => l.debt.id),
  };
}

export interface PaydownComparison {
  /** Every minimum paid separately: no extra, no rolling. */
  baseline: PaydownRun;
  plan: PaydownRun;
  /**
   * baseline.totalInterest − plan.totalInterest, or null when the baseline
   * itself never pays off. A baseline that stalls stops at MAX_PAYDOWN_MONTHS
   * having accrued fifty years of interest on a balance that never fell, so
   * the difference is a measure of the ceiling, not of the plan.
   */
  interestSaved: number | null;
  /** baseline.monthsToDebtFree − plan.monthsToDebtFree, null on the same
   * condition and for the same reason. */
  monthsSaved: number | null;
  /** "YYYY-MM" the last dollar is paid under the plan, or null if it never is. */
  debtFreeMonth: string | null;
}

/**
 * "YYYY-MM" of the `n`th month, counting the start month as month 1. Mirrors
 * `payoffMonth()` in `@/lib/portal/loan-details` so a payoff date shown here
 * and one shown on the Accounts screen mean the same thing.
 */
export function monthLabel(startYear: number, startMonth: number, n: number): string {
  const zeroBased = startYear * 12 + (startMonth - 1) + Math.max(0, n - 1);
  const year = Math.floor(zeroBased / 12);
  const month = (zeroBased % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** The inverse: how many months from the start until "YYYY-MM", 1-based. */
export function monthsUntil(startYear: number, startMonth: number, target: string): number {
  const [y, m] = target.split("-").map(Number);
  return y * 12 + (m - 1) - (startYear * 12 + (startMonth - 1)) + 1;
}

/**
 * The plan against doing nothing. The baseline deliberately drops BOTH the
 * extra payment and the rolling, so a household with two or more debts sees a
 * real saving even at $0 extra — rolling a cleared debt's payment into the
 * next one is itself the strategy, and it is the thing worth showing them.
 */
export function comparePaydown(
  debts: PaydownDebt[],
  opts: PaydownOptions,
): PaydownComparison {
  const baseline = simulatePaydown(debts, { ...opts, extraMonthly: 0, roll: false });
  const plan = simulatePaydown(debts, { ...opts, roll: true });
  // Whatever the plan is compared AGAINST has to be a real outcome. When the
  // minimums do not cover their own interest — an $8,000 card at 19.99% with
  // the bank's $120 minimum, the commonest reason anyone opens this screen —
  // the baseline just runs to MAX_PAYDOWN_MONTHS, and the difference reads as
  // "$16,143,991 saved" and "47 yr 9 mo saved" on the two headline tiles.
  // Null instead, so the caller has to say something true. Same reasoning as
  // `debtFreeMonth` below, for the other side of the comparison.
  const comparable = !baseline.neverPaysOff;
  return {
    baseline,
    plan,
    interestSaved: comparable ? baseline.totalInterest - plan.totalInterest : null,
    monthsSaved: comparable ? baseline.monthsToDebtFree - plan.monthsToDebtFree : null,
    // A plan that never pays off has no real date — MAX_PAYDOWN_MONTHS
    // rendered through monthLabel would read as a confident date ~50 years
    // out, on the same screen that names the debt as never clearing.
    debtFreeMonth: plan.neverPaysOff
      ? null
      : monthLabel(opts.startYear, opts.startMonth, plan.monthsToDebtFree),
  };
}

export interface GoalSeekResult {
  /** The extra monthly payment needed, rounded up to the dollar. Meaningless
   *  (the whole remaining balance) when `unreachable` is true. */
  extraMonthly: number;
  /** What that payment actually achieves. */
  monthsToDebtFree: number;
  /** True when no extra is needed — they finish by then already. */
  alreadyOnTrack: boolean;
  /** True when even paying the entire balance as extra cannot hit the target. */
  unreachable: boolean;
}

/**
 * The payment that gets them done by `targetMonths`. Binary search over the
 * same simulator, bracketed between $0 (already known insufficient — we'd
 * have returned above) and the whole remaining balance paid as extra. That
 * upper bound is NOT guaranteed to satisfy the target: a debt whose minimum
 * does not cover its own monthly interest still burns a month or more just
 * absorbing interest before the extra payment can touch principal, so the
 * bracket's top is checked before searching. When even it fails, the target
 * is unreachable and is reported as such rather than answered with a
 * spurious payment — the same rule the $0 "already on track" case applies in
 * the other direction. ~60 runs when reachable, which is nothing — this
 * happens between keystrokes.
 */
export function solveExtraForTarget(
  debts: PaydownDebt[],
  strategy: PaydownStrategy,
  targetMonths: number,
  startYear: number,
  startMonth: number,
): GoalSeekResult {
  const run = (extraMonthly: number): PaydownRun =>
    simulatePaydown(debts, { strategy, extraMonthly, startYear, startMonth });

  const meets = (r: PaydownRun): boolean =>
    !r.neverPaysOff && r.monthsToDebtFree <= targetMonths;

  const zero = run(0);
  if (meets(zero)) {
    return {
      extraMonthly: 0,
      monthsToDebtFree: zero.monthsToDebtFree,
      alreadyOnTrack: true,
      unreachable: false,
    };
  }

  let lo = 0; // known insufficient
  let hi = debts.reduce((sum, d) => sum + d.balance, 0) || 1; // upper bound to test
  const hiRun = run(hi);
  if (!meets(hiRun)) {
    return {
      extraMonthly: Math.ceil(hi),
      monthsToDebtFree: hiRun.monthsToDebtFree,
      alreadyOnTrack: false,
      unreachable: true,
    };
  }

  for (let i = 0; i < 60 && hi - lo > 1; i++) {
    const mid = (lo + hi) / 2;
    if (meets(run(mid))) hi = mid;
    else lo = mid;
  }

  const extraMonthly = Math.ceil(hi);
  return {
    extraMonthly,
    monthsToDebtFree: run(extraMonthly).monthsToDebtFree,
    alreadyOnTrack: false,
    unreachable: false,
  };
}

/**
 * Monthly points the balance chart plots — the longer of the two runs, since
 * the shorter series is padded out to match it.
 */
export function paydownChartPoints(c: PaydownComparison): number {
  return Math.max(c.baseline.balanceSeries.length, c.plan.balanceSeries.length);
}

/**
 * A line needs two points. Below that the chart draws nothing at all, so its
 * caller has to supply the words instead of framing an empty box.
 *
 * Lives here, next to the data it judges, rather than in the chart component:
 * the caller has to ask the question BEFORE deciding to render the chart, and
 * a rule spelled out in both places is one that drifts back into a bordered
 * box with nothing going red.
 */
export function paydownChartIsEmpty(c: PaydownComparison): boolean {
  return paydownChartPoints(c) < 2;
}
