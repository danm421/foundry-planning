import type { Tidbit } from "@/lib/presentations/tidbits";
import type { DeflationBasis, DollarPair } from "@/lib/presentations/real-dollars";

/**
 * What the page says about the employer match.
 *
 * There is deliberately no "shortfall" arm. `computeEmployerMatch`
 * (`src/engine/savings.ts`) is `salary × employerMatchCap × employerMatchPct` —
 * it never reads the employee's deferral rate, so the plan deposits the full
 * match no matter how little the client defers. A "you're leaving $X on the
 * table" sentence would therefore be a number this engine cannot measure, and
 * it would contradict the ladder chart on the very next sheet, which shows the
 * same employer dollars at every rung.
 */
export type MatchLine =
  | { kind: "none" }
  | { kind: "captured"; employerAnnual: DollarPair };

export interface EarlyYearsStandingPageData {
  /** Scenario label · age · starting year. The page is pinned to Base Case,
   *  so naming the scenario is what
   *  keeps it honest inside a deck built on some other one. */
  subtitle: string;
  /** True when the household has no salary — a savings RATE has no denominator,
   *  so the page says so instead of printing a 0% that is not true. */
  isEmpty: boolean;
  clientAge: number;
  /** What the deck means by "today's dollars": the year quoted in, and the rate
   *  converted at. The reading-the-dollars panel prints both, so the client is
   *  told the plan's OWN assumption rather than a generic 3%. Same shape the
   *  ladder and waiting sheets carry, so one concept has one spelling. */
  basis: DeflationBasis;
  grossAnnual: DollarPair;
  contributionsAnnual: DollarPair;
  /** Fraction of salary, 0–1. */
  savingsRatePct: number;
  portfolio: DollarPair;
  match: MatchLine;
  tidbits: Tidbit[];
}

export interface EarlyYearsStandingPageOptions {
  showMatchLine: boolean;
  /** Tidbit ids, max 2. */
  tidbits: string[];
}

export const EARLY_YEARS_STANDING_OPTIONS_DEFAULT: EarlyYearsStandingPageOptions = {
  showMatchLine: true,
  tidbits: [],
};
