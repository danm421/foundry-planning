// Pure equity-compensation domain types. Framework-free.

export type GrantType = "rsu" | "nqso" | "iso";
export type ExerciseTiming = "at_vest" | "specific_year" | "year_before_expiration" | "manual";
export type SellTiming = "immediately" | "hold_then_sell_year" | "percent_per_year" | "hold";

/** A strategy fragment. Every field optional so it can express a partial
 *  override that inherits the rest from a less-specific level. */
export interface EquityStrategy {
  exerciseTiming?: ExerciseTiming | null;
  exerciseYear?: number | null;
  sellTiming?: SellTiming | null;
  sellYear?: number | null;
  sellPercentPerYear?: number | null; // 0..1
  sellStartYear?: number | null;
}

export interface EquityPlannedEvent {
  year: number;
  action: "exercise" | "sell";
  shares?: number | null;
  pct?: number | null; // 0..1
  trancheId?: string | null;
}

export interface EquityVestTranche {
  id: string;
  /** Real vest date, `YYYY-MM-DD`. The ONLY vesting-time field.
   *
   *  The year-based strategy layer (`sellYear`, `exerciseYear`, `sellStartYear`
   *  are year integers in the database) reads `yearOf(vestDate)` at the point of
   *  use. Storing a `vestYear` alongside would be two fields that must agree —
   *  the same footgun this group removed for cost basis. */
  vestDate: string;
  shares: number;
  sharesExercised: number; // actuals
  sharesSold: number;      // actuals
  /** When the shares recorded in `sharesExercised` (options) or the
   *  already-vested shares (RSU) were ACTUALLY acquired. Null = the advisor has
   *  not entered it; `tax-events.ts` then falls back conservatively and the
   *  screen says the figure is estimated. Audit F1/F2. */
  acquiredOn: string | null;
  /** FMV per share on `acquiredOn` — FMV at exercise for an option, FMV at vest
   *  for an RSU. Basis is DERIVED from this (ISO = strike, otherwise this), so
   *  there is never a second stored source of truth for basis. Audit F1. */
  priceAtAcquisition: number | null;
  strategy?: EquityStrategy | null;
}

export interface EquityGrant {
  id: string;
  grantNumber: string | null;
  grantType: GrantType;
  /** Real grant date, `YYYY-MM-DD`. The §422(a)(1) two-year leg reads THIS, and
   *  it is the only grant-time field — see the note on `vestDate`. */
  grantDate: string;
  sharesGranted: number;
  has83bElection: boolean;
  fmvAtGrant?: number | null;
  strikePrice?: number | null;
  strikeDiscountPct?: number | null; // 0..1; applied to FMV at exercise when strikePrice null
  expirationYear?: number | null;
  strategy?: EquityStrategy | null;
  tranches: EquityVestTranche[];
  plannedEvents: EquityPlannedEvent[];
}

/** One stock_options account — one company/stock, many grants. */
export interface StockOptionPlan {
  accountId: string;
  ticker?: string | null;
  pricePerShare: number;        // FMV/share as of planStartYear
  growthRate: number;           // resolved per-share appreciation rate
  destinationAccountId?: string | null;
  autoCreateDestination: boolean;
  sellToCover: boolean;
  withholdingRate: number;      // 0..1
  strategy: EquityStrategy;     // account-level default (always fully populated)
  owner: "client" | "spouse";
  grants: EquityGrant[];
}
