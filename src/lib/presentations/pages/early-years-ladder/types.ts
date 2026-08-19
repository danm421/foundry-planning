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
  /** Empty when the ladder could not be modelled — no variant was built, or the
   *  plan has no payroll deferral the report can move. The page prints its
   *  empty state rather than three identical bars under three labels. */
  groups: LadderGroup[];
  rungs: Rung[];
  /** Rungs whose extra percent bought no extra contribution — the §402(g)
   *  deferral limit absorbed it. */
  cappedRungLabels: string[];
  /** One sentence naming the gap at the last milestone age; null when there is
   *  no raised rung to compare against. */
  takeaway: string | null;
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
