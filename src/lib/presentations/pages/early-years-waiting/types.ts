import type { Tidbit } from "@/lib/presentations/tidbits";
import type { DeflationBasis } from "@/lib/presentations/real-dollars";
import type { DollarPair } from "@/lib/presentations/real-dollars";

export interface WaitingBar {
  /** Portfolio at this milestone age, in real and nominal dollars. */
  value: DollarPair;
}

export interface WaitingGroup {
  age: number;
  year: number;
  bars: WaitingBar[];
}

export interface EarlyYearsWaitingPageData {
  /** Scenario label · the deck's two-unit reading rule. */
  subtitle: string;
  /** Empty when the page could not be modelled; `emptyMessage` then says why. */
  groups: WaitingGroup[];
  /** Legend text, in bar order — "Start now", "Start in 5 years", … */
  seriesLabels: string[];
  /** The rate every arm saves at once its increase begins, as a fraction. */
  raisedRate: number;
  /** One sentence pricing the first delay at the last milestone age; null when
   *  there is only one start date to draw. */
  takeaway: string | null;
  /** True when the raised contribution reached the IRS annual limit, so every
   *  bar shows the capped amount. */
  isCapped: boolean;
  emptyMessage: string | null;
  tidbits: Tidbit[];
  basis: DeflationBasis;
}

export interface EarlyYearsWaitingPageOptions {
  /** Points added to what the client saves today — the ladder's middle rung. */
  rungOffset: number;
  /** Years to postpone the increase by. The first is normally 0 ("start now"). */
  delays: number[];
  /** Ages the chart clusters bars at. */
  milestoneAges: number[];
  /** Tidbit ids, max 2. */
  tidbits: string[];
}

// The chart prices a delay; the notes say why a delay costs more than the years
// it skips, and why the runway itself is the scarce thing.
export const EARLY_YEARS_WAITING_OPTIONS_DEFAULT: EarlyYearsWaitingPageOptions = {
  rungOffset: 0.03,
  delays: [0, 5, 10],
  milestoneAges: [40, 50, 65],
  tidbits: ["compounding-cost-of-waiting", "compounding-runway"],
};
