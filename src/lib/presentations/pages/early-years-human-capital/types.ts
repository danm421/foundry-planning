import type { Tidbit } from "@/lib/presentations/tidbits";
import type { DollarPair } from "@/lib/presentations/real-dollars";

export interface HumanCapitalDetailRow {
  year: number;
  age: number;
  salary: DollarPair;
}

export interface EarlyYearsHumanCapitalPageData {
  /** Scenario label · the deck's two-unit reading rule. */
  subtitle: string;
  /** True when the plan projects no salary at all: there is no human capital to
   *  weigh a portfolio against, and two bars would be one bar. */
  isEmpty: boolean;
  /** Liquid portfolio in the plan's first year, in both units. */
  invested: DollarPair;
  /** Every future salary dollar the plan projects, summed separately in real
   *  and nominal units. */
  lifetimeEarnings: DollarPair;
  /** lifetimeEarnings ÷ investedToday; null when nothing is invested yet. */
  multiple: number | null;
  /** Last plan year that still pays a salary — how far "remaining" runs. */
  lastEarningYear: number | null;
  takeaway: string;
  detailRows: HumanCapitalDetailRow[];
  tidbits: Tidbit[];
}

export interface EarlyYearsHumanCapitalPageOptions {
  /** Tidbit ids, max 2. */
  tidbits: string[];
}

export const EARLY_YEARS_HUMAN_CAPITAL_OPTIONS_DEFAULT: EarlyYearsHumanCapitalPageOptions =
  { tidbits: [] };
