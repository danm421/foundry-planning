import type { ProjectionYear } from "@/engine";
import { amtApplies } from "@/lib/tax/amt";

export type TransitionType =
  | "amt_first_year"
  | "niit_first_year"
  | "addl_medicare_first_year"
  | "retirement_fica_zero"
  | "marginal_rate_jump";

/**
 * Scan a projection and flag the year a regime transition first occurs.
 * First year of the projection never produces a transition (no prior to compare).
 * Returns a map keyed by year; years without transitions are absent from the map.
 */
export function detectRegimeTransitions(
  years: ProjectionYear[]
): Record<number, TransitionType[]> {
  const out: Record<number, TransitionType[]> = {};

  for (let i = 0; i < years.length; i++) {
    const curr = years[i];
    const prev = i > 0 ? years[i - 1] : null;
    // `flow` and not just `taxResult`: now that year ZERO is inspected, a
    // partially-built year reaches this line where it used to be skipped.
    if (!curr.taxResult?.flow) continue;

    const transitions: TransitionType[] = [];
    const c = curr.taxResult.flow;

    // AMT is checked from year ZERO. The old loop started at the second year,
    // so a client already in AMT in the projection's first year — exactly what
    // a January option exercise produces — was never flagged, and a spell that
    // began in year one was never flagged at all (F20).
    if (amtApplies(c.amtAdditional) && !amtApplies(prev?.taxResult?.flow?.amtAdditional)) {
      transitions.push("amt_first_year");
    }

    // The remaining detectors are genuine year-over-year comparisons and still
    // need a prior year to compare against.
    if (!prev?.taxResult?.flow) {
      if (transitions.length > 0) out[curr.year] = transitions;
      continue;
    }
    const p = prev.taxResult.flow;

    if (c.niit > 0 && p.niit === 0) {
      transitions.push("niit_first_year");
    }
    if (c.additionalMedicare > 0 && p.additionalMedicare === 0) {
      transitions.push("addl_medicare_first_year");
    }
    if (c.fica === 0 && p.fica > 0) {
      transitions.push("retirement_fica_zero");
    }

    const currMarginal = curr.taxResult.diag.marginalFederalRate;
    const prevMarginal = prev.taxResult.diag.marginalFederalRate;
    if (currMarginal - prevMarginal >= 0.05) {
      transitions.push("marginal_rate_jump");
    }

    if (transitions.length > 0) {
      out[curr.year] = transitions;
    }
  }

  return out;
}

/**
 * Tooltip copy for each transition type. Used by table components to display
 * a hover explanation on the indicator.
 */
export const TRANSITION_TOOLTIPS: Record<TransitionType, string> = {
  // Fallback only — every table renders the AMT marker through `regimeTooltip`
  // below, which replaces this with the year's actual driver.
  amt_first_year:
    "AMT applies this year, so the next dollar of income is taxed at the AMT rate rather than your ordinary bracket rate.",
  niit_first_year:
    "First year NIIT applies. MAGI now exceeds the $250k MFJ / $200k single threshold.",
  addl_medicare_first_year:
    "First year additional Medicare applies. Earned income now exceeds the threshold.",
  retirement_fica_zero:
    "First year with no FICA. Earned income has stopped.",
  marginal_rate_jump:
    "Marginal rate jumped at least 5 percentage points — you crossed into a higher bracket this year.",
};

/**
 * Color class for the year-cell left border given a transition type.
 * Green for retirement (positive planning event), amber for tax surcharges
 * kicking in, blue for bracket transitions.
 */
export const TRANSITION_BORDER_CLASS: Record<TransitionType, string> = {
  amt_first_year: "border-l-4 border-amber-500",
  niit_first_year: "border-l-4 border-amber-500",
  addl_medicare_first_year: "border-l-4 border-amber-500",
  retirement_fica_zero: "border-l-4 border-green-500",
  marginal_rate_jump: "border-l-4 border-blue-500",
};

/**
 * When multiple transitions land on the same year, priority ordering for
 * picking the single border color. Amber (surcharge) wins over green/blue
 * since it's usually the more actionable signal for an advisor.
 */
export function pickBorderTransition(transitions: TransitionType[]): TransitionType {
  const priority: TransitionType[] = [
    "amt_first_year",
    "niit_first_year",
    "addl_medicare_first_year",
    "marginal_rate_jump",
    "retirement_fica_zero",
  ];
  for (const t of priority) {
    if (transitions.includes(t)) return t;
  }
  return transitions[0];
}

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * Why AMT applies this year, named from the figures the year already carries.
 *
 * The old fixed copy said "usually driven by high AGI phasing out your AMT
 * exemption" for every client. For an option client that is wrong twice over:
 * the driver is the bargain element, and the AGI sitting in the next column is
 * often small — so the advisor reads the marker as a data-entry error and
 * misses the planning move (splitting the exercise across two tax years).
 *
 * The exemption phase-out is kept as a real fallback, not discarded: a
 * gains-heavy client with no options genuinely can trip AMT that way. It is
 * phrased against AMT INCOME, which is what the phase-out actually keys off —
 * for the option client above, AMT income and AGI differ by a factor of twelve.
 */
function amtTooltip(year: ProjectionYear, isFirstOfSpell: boolean): string {
  const amt = year.taxResult?.flow.amtAdditional ?? 0;
  const amti = year.taxResult?.diag.amti;
  const isoSpread = year.equityTaxImpact?.isoSpread ?? 0;

  const opener = isFirstOfSpell
    ? `First year AMT applies — ${usd(amt)}.`
    : `AMT applies in ${year.year} — ${usd(amt)}.`;

  const parts = [opener];

  if (isoSpread > 0) {
    parts.push(
      `The largest driver is the ${usd(isoSpread)} bargain element on this year's option ` +
      `exercise, which counts as income for AMT but not for regular tax.`,
    );
    if (amti != null) parts.push(`AMT income is ${usd(amti)}.`);
    parts.push("Splitting an exercise across two tax years is the usual way to reduce this.");
  } else if (amti != null) {
    parts.push(
      `Driven by AMT income of ${usd(amti)}, which phases out your AMT exemption. ` +
      `AMT income adds back deductions the AMT does not allow.`,
    );
  } else {
    parts.push("Driven by AMT income above the level where your AMT exemption phases out.");
  }

  return parts.join(" ");
}

/**
 * Tooltip for a year's markers. Static copy for most transitions; the AMT one
 * is built per-year because its cause differs per client (F20).
 *
 * Takes the whole projection so the "first year" claim is decided here rather
 * than at each of the three tables that render this: when the projection opens
 * already in AMT the marker still belongs on the row, but nothing in the data
 * supports calling it the client's FIRST AMT year.
 */
export function regimeTooltip(
  years: ProjectionYear[],
  year: ProjectionYear,
  types: TransitionType[],
): string {
  const amtIsObservedStart = years.length > 0 && years[0].year !== year.year;
  return types
    .map((t) =>
      t === "amt_first_year" ? amtTooltip(year, amtIsObservedStart) : TRANSITION_TOOLTIPS[t],
    )
    .join("\n");
}
