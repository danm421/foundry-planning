import type { Tidbit } from "@/lib/presentations/tidbits";

export interface EarlyYearsHumanCapitalPageData {
  /** Scenario label · the today's-dollars note, in the house subtitle form. */
  subtitle: string;
  /** True when the plan projects no salary at all: there is no human capital to
   *  weigh a portfolio against, and two bars would be one bar. */
  isEmpty: boolean;
  /** Liquid portfolio in the plan's first year, today's dollars. */
  investedToday: number;
  /** Every future salary dollar the plan projects, each deflated to the plan's
   *  start year and summed. */
  lifetimeEarnings: number;
  /** lifetimeEarnings ÷ investedToday; null when nothing is invested yet. */
  multiple: number | null;
  /** Last plan year that still pays a salary — how far "remaining" runs. */
  lastEarningYear: number | null;
  takeaway: string;
  tidbits: Tidbit[];
}

export interface EarlyYearsHumanCapitalPageOptions {
  /** Tidbit ids, max 2. */
  tidbits: string[];
}

export const EARLY_YEARS_HUMAN_CAPITAL_OPTIONS_DEFAULT: EarlyYearsHumanCapitalPageOptions =
  { tidbits: [] };
