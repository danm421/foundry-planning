import type { ChartSpec } from "@/lib/presentations/charts/types";
import type { AmortizationScheduleRow, AmortizationTotals } from "@/lib/loan-math";

export interface LiabilityAmortizationPageOptions {
  /** The loans to print, one section each. `null` = every amortizing loan on
   *  the plan: the default, and the only choice that carries to another
   *  household when the deck is saved as a template (ids are per client). */
  liabilityIds: string[] | null;
}

export const LIABILITY_AMORTIZATION_OPTIONS_DEFAULT: LiabilityAmortizationPageOptions = {
  liabilityIds: null,
};

export type AmortizationTableRow = Pick<
  AmortizationScheduleRow,
  "year" | "payment" | "interest" | "principal" | "extraPayment" | "endingBalance"
> & { isCurrentYear: boolean };

export interface LoanAmortizationSection {
  liabilityId: string;
  name: string;
  /** Key terms printed under the heading: balance, rate, payment, payoff. */
  facts: Array<{ label: string; value: string }>;
  chartSpec: ChartSpec;
  /** The schedule split into sheets. The first sheet also carries the facts
   *  and the chart; the last also carries the totals row and the footnote. */
  sheets: AmortizationTableRow[][];
  totals: AmortizationTotals;
  footnote: string | null;
}

export interface LiabilityAmortizationPageData {
  subtitle: string;
  loans: LoanAmortizationSection[];
}
