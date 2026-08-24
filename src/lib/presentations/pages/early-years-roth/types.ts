import type { Tidbit } from "@/lib/presentations/tidbits";
import type { DollarPair } from "@/lib/presentations/real-dollars";

/** Why this plan cannot be compared. Three reasons, because they need three
 *  different sentences: a client whose plan runs on the flat tax engine has a
 *  different problem from a client with no 401(k), and one sentence for both
 *  would be wrong for both. */
export type RothBlocker = "flat-tax-mode" | "no-deferral-account" | "no-variant";

export interface RothRow {
  label: string;
  traditional: DollarPair;
  roth: DollarPair;
  /** True for the tax rows: the smaller figure is the better outcome. False for
   *  the spending row. The sheet marks the better column, and marking the wrong
   *  one is the defect this flag exists to prevent. */
  betterIsLower: boolean;
}

export interface RothDetailRow {
  year: number;
  age: number;
  traditionalTax: DollarPair;
  rothTax: DollarPair;
}

export interface EarlyYearsRothPageData {
  /** Scenario label · the deck's two-unit reading rule. */
  subtitle: string;
  /** Empty when the comparison could not be made; `emptyMessage` says why. */
  rows: RothRow[];
  detailRows: RothDetailRow[];
  takeaway: string | null;
  /** True when the two retirement-spending figures land within half a percent —
   *  this plan's spending is fixed, so the choice can only show up in the tax
   *  bill, and the sheet says so rather than printing two equal numbers under a
   *  heading that promises a difference. */
  spendingIsFixed: boolean;
  emptyMessage: string | null;
  tidbits: Tidbit[];
}

export interface EarlyYearsRothPageOptions {
  /** Tidbit ids, max 2. */
  tidbits: string[];
}

// The two tax notes that answer the question in the page title: which rate to
// pay, and why an early-career rate is usually the one worth paying.
export const EARLY_YEARS_ROTH_OPTIONS_DEFAULT: EarlyYearsRothPageOptions = {
  tidbits: ["taxes-roth-vs-traditional", "lowest-bracket-of-your-life"],
};
