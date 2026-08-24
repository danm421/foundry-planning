import type { ClientData, ProjectionYear } from "@/engine";
import { ageLabel } from "./cashflow-year-detail";

/** Nominal = the engine's own future dollars. Today = deflated to plan-start
 *  purchasing power, which is the only unit a household reasons in. */
export type DollarBasis = "today" | "nominal";

const MONTHS_PER_YEAR = 12;

/** Costs the household has already committed. Living expenses are deliberately
 *  absent — they are what the leftover PAYS FOR, not something taken off it. */
export interface MonthlyFixedCosts {
  taxes: number;
  liabilities: number;
  savings: number;
  insurance: number;
  realEstate: number;
  other: number;
  total: number;
}

export interface MonthlyCashFlowRow {
  year: number;
  ageLabel: string;
  /** Monthly income. Excludes any portfolio draw — that is its own line. */
  income: number;
  fixed: MonthlyFixedCosts;
  /** income − fixed.total. Negative in most retirement years, and that is the
   *  honest signal rather than an error state. */
  leftAfterFixed: number;
  /** Household supplemental withdrawals only. `entityWithdrawals` are trust and
   *  business internal refills — not household money, never counted here. */
  portfolioDraw: number;
  /** The household's whole monthly lifestyle budget, living expenses included. */
  available: number;
  split: MonthlyAvailableSplit;
}

/** Where the available money actually goes today. The three named parts each
 *  come from the engine directly; `unexplained` is whatever they cannot account
 *  for and is always shown as its own row — never folded into `available`. A
 *  leftover number that doubles as a dumping ground is worse than no number. */
export interface MonthlyAvailableSplit {
  living: number;
  surplusSpent: number;
  surplusUnspent: number;
  unexplained: number;
}

/**
 * The surplus the household did not spend — transferred to a savings
 * destination, or left sitting in checking.
 *
 * POSITIVE AMOUNTS ONLY, and that is load-bearing. `surplus_transfer` is booked
 * as two legs: −saveAmount debited from checking (projection.ts:7175) and
 * +saveAmount credited to the destination (:7200). Summing both nets to zero
 * and silently reports "nothing saved" for every plan with a save destination.
 * `surplus_retained` is a single positive leg on checking (:7215).
 */
function surplusUnspentAnnual(y: ProjectionYear): number {
  let total = 0;
  for (const ledger of Object.values(y.accountLedgers)) {
    for (const entry of ledger.entries) {
      if (entry.category !== "surplus_transfer" && entry.category !== "surplus_retained") {
        continue;
      }
      if (entry.amount > 0) total += entry.amount;
    }
  }
  return total;
}

/** Deflate to plan-start purchasing power. Returns 1 for the nominal basis and
 *  for the plan's own first year, so the near-term figures are untouched. */
function deflator(
  year: number,
  basis: DollarBasis,
  planSettings: ClientData["planSettings"],
): number {
  if (basis === "nominal") return 1;
  const rate = planSettings.inflationRate;
  return 1 / (1 + rate) ** (year - planSettings.planStartYear);
}

export function buildMonthlyCashFlowRows(
  years: ProjectionYear[],
  clientData: ClientData,
  basis: DollarBasis = "today",
): MonthlyCashFlowRow[] {
  return years.map((y) => {
    // One scale factor per year: annual → monthly, then nominal → chosen basis.
    const k = deflator(y.year, basis, clientData.planSettings) / MONTHS_PER_YEAR;

    const fixed: MonthlyFixedCosts = {
      taxes: y.expenses.taxes * k,
      liabilities: y.expenses.liabilities * k,
      savings: y.savings.total * k,
      insurance: y.expenses.insurance * k,
      realEstate: y.expenses.realEstate * k,
      // `expenses.other` already contains cash gifts, exactly once — measured,
      // not assumed; the "cash gifts" test pins it. Do NOT add
      // `expenses.cashGifts` here or a gifting year double-counts the gift.
      other: y.expenses.other * k,
      total: 0,
    };
    fixed.total =
      fixed.taxes +
      fixed.liabilities +
      fixed.savings +
      fixed.insurance +
      fixed.realEstate +
      fixed.other;

    const income = y.totalIncome * k;
    const leftAfterFixed = income - fixed.total;
    const portfolioDraw = y.withdrawals.total * k;
    const available = leftAfterFixed + portfolioDraw;

    const living = y.expenses.living * k;
    const surplusSpent = y.expenses.discretionary * k;
    const surplusUnspent = surplusUnspentAnnual(y) * k;

    const split: MonthlyAvailableSplit = {
      living,
      surplusSpent,
      surplusUnspent,
      unexplained: available - living - surplusSpent - surplusUnspent,
    };

    return {
      year: y.year,
      ageLabel: ageLabel(y),
      income,
      fixed,
      leftAfterFixed,
      portfolioDraw,
      available,
      split,
    };
  });
}
