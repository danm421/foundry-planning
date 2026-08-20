import type { Tidbit } from "@/lib/presentations/tidbits";

export interface DebtOrInvestArm {
  label: string;
  /** The year this arm clears the loan. */
  debtFreeYear: number;
  /** Interest paid on THIS loan over the whole plan, today's dollars. */
  interestPaid: number;
  /** Liquid portfolio at the milestone age, today's dollars. */
  portfolioAtMilestone: number;
}

export interface EarlyYearsDebtOrInvestPageData {
  subtitle: string;
  liabilityName: string;
  /** Extra dollars a month, as the advisor set them. */
  monthlyAmount: number;
  milestoneAge: number;
  /** Both null when the comparison could not be built; `emptyMessage` says why.
   *  Never one without the other — half a comparison is not a comparison. */
  loan: DebtOrInvestArm | null;
  invest: DebtOrInvestArm | null;
  takeaway: string | null;
  emptyMessage: string | null;
  tidbits: Tidbit[];
}

export interface EarlyYearsDebtOrInvestPageOptions {
  /** Extra dollars a month. Advisor-set — which is why the page title cannot
   *  name an amount. */
  monthlyAmount: number;
  /** Which loan. Null → the largest eligible balance. */
  liabilityId: string | null;
  /** Age the portfolio comparison is quoted at. */
  milestoneAge: number;
  /** Tidbit ids, max 2. */
  tidbits: string[];
}

export const EARLY_YEARS_DEBT_OR_INVEST_OPTIONS_DEFAULT: EarlyYearsDebtOrInvestPageOptions = {
  monthlyAmount: 500,
  liabilityId: null,
  milestoneAge: 65,
  tidbits: [],
};
