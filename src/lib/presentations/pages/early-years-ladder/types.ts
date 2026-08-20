import type { Tidbit } from "@/lib/presentations/tidbits";
import type { DeflationBasis } from "@/lib/presentations/real-dollars";
import type { Rung, RungConfig } from "./rungs";

export interface LadderBar {
  /** The rung's own label — "Save 11%". */
  label: string;
  /** True for the bar that is the plan as it stands today. */
  isCurrent: boolean;
  /** Portfolio at this milestone age, in the plan's start-year dollars. */
  value: number;
}

export interface LadderGroup {
  age: number;
  bars: LadderBar[];
}

export interface EarlyYearsLadderPageData {
  /** Scenario label · the today's-dollars note, in the house subtitle form. */
  subtitle: string;
  /** Empty when the ladder could not be modelled; `emptyMessage` then says why.
   *  The page prints that instead of three identical bars under three labels. */
  groups: LadderGroup[];
  rungs: Rung[];
  /** Rungs whose extra percent bought no extra contribution — the §402(g)
   *  deferral limit absorbed it. */
  cappedRungLabels: string[];
  /** One sentence naming the gap at the last milestone age; null when there is
   *  no raised rung to compare against. */
  takeaway: string | null;
  /** Why there is no chart, in the client's words; null when there is one. The
   *  page prints exactly this — the reasons are not interchangeable, and one
   *  of them ("no payroll retirement contributions") is false on a plan that
   *  contributes the annual maximum. */
  emptyMessage: string | null;
  tidbits: Tidbit[];
  basis: DeflationBasis;
}

export interface EarlyYearsLadderPageOptions {
  rungs: RungConfig;
  /** Ages the chart clusters bars at. */
  milestoneAges: number[];
  /** Tidbit ids, max 2. */
  tidbits: string[];
}

export const EARLY_YEARS_LADDER_OPTIONS_DEFAULT: EarlyYearsLadderPageOptions = {
  rungs: { mode: "relative", offsets: [0, 0.03, 0.06] },
  milestoneAges: [40, 50, 65],
  tidbits: [],
};
