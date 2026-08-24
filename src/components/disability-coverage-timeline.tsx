"use client";

/**
 * Reads a `ResolvedCoverage` straight from the engine and draws the two benefit
 * layers on one month-scaled bar.
 *
 * Two things carry the meaning and neither is colour:
 *  - Lanes. Short-term always occupies the TOP half of the bar and long-term the
 *    BOTTOM half, so where the two overlap the advisor sees two simultaneous
 *    payments stacked rather than one band interrupting another.
 *  - The legend labels, whose swatches mirror the same lanes.
 *
 * The bar never re-derives a benefit or a month from the policy — every figure
 * comes from `resolveCoverage`, which is also what the projection pays on. A
 * second derivation here is how a screen and its engine drift apart.
 */

import type { CSSProperties } from "react";
import { DAYS_PER_MONTH, type ResolvedCoverage } from "@/engine/disability-benefits";

/** Past this the bar stops being readable: a to-age-65 benefit period runs
 *  hundreds of months and squashes a 13-week short-term band into a hairline.
 *  The bar clips with a "…" cap; the legend still names the true end month. */
const MAX_BAR_MONTHS = 120;

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** One decimal, dropping a trailing zero: 0.22998 → "0.2", 84 → "84". */
const fmtMonths = (m: number) => String(Math.round(m * 10) / 10);

const HATCH: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, var(--color-hair-2) 0 2px, transparent 2px 6px)",
};

/** Replacement rate while BOTH layers pay, as a whole-number percentage. Null
 *  when there is nothing to divide by — a fabricated "0%" inside a warning
 *  reads as a measurement.
 *
 *  Both disjuncts are unreachable today and both stay. The null-window one is a
 *  theorem, not a sample result: `disability-benefits.ts:120-125` assigns `seam`
 *  ONLY inside `if (shortTerm && longTerm)`, so a seam implies two windows. The
 *  zero-earnings one holds only because `coverageAlert` returns before the
 *  overlap branch — a NON-LOCAL invariant living in another function, which is
 *  exactly why deleting the guard would be wrong. */
function combinedPct(c: ResolvedCoverage): number | null {
  if (c.shortTerm === null || c.longTerm === null || c.coveredEarnings <= 0) return null;
  const monthly = c.shortTerm.monthlyBenefit + c.longTerm.monthlyBenefit;
  return Math.round(((monthly * 12) / c.coveredEarnings) * 100);
}

/** At most one alert, most-blocking first — and "most blocking" is measured by
 *  HOW MANY LAYERS the condition stops paying, not by which reads worse.
 *
 *  Zero covered earnings is checked FIRST because it kills BOTH layers: every
 *  band on the bar pays $0/mo and no field the advisor can edit on this screen
 *  changes that. `missing_dob` kills the long-term layer alone — short-term is
 *  built from `policy.shortTerm` and never consults a date of birth, so it
 *  still resolves and the projection still pays it.
 *
 *  The two co-occur on an ordinary half-finished onboarding (a spouse with
 *  neither a DOB nor salary rows). Reported the other way round, the advisor is
 *  told a date of birth fixes it, adds one, and the policy still pays nothing —
 *  a remedy the data contradicts. `disability-panel.tsx` carries the identical
 *  precedence, and `disability-panel.test.tsx` renders both surfaces on the
 *  same fixtures to keep them from drifting apart again. */
function coverageAlert(c: ResolvedCoverage): { tone: "crit" | "warn"; message: string } | null {
  if (c.coveredEarnings <= 0 && (c.shortTerm !== null || c.longTerm !== null)) {
    // Reachable through the app, not theoretical: in salary mode
    // `resolveCoveredEarnings` returns 0 whenever the insured has no salary rows
    // — a non-earning spouse, or rows that end before the disability year — and
    // nothing gates that. Manual mode reaches 0 two ways: a deliberate 0, which
    // `z.number().gte(0)` permits on create, and a null amount, which
    // `validateCrossFields` rejects on CREATE but not on UPDATE — it is a
    // `superRefine` over a `strictPartial`, so a PATCH that omits
    // `coveredEarningsMode` never runs the manual check and stores the null
    // (observed: `PATCH {"coveredEarningsAmount": null}` parses clean). The
    // bands are gated on the policy sections and the benefit period, never on
    // earnings, so they render at $0/mo with no explanation unless we give one.
    return {
      tone: "crit",
      message: "No covered earnings are on file for the insured, so this policy pays nothing.",
    };
  }
  if (c.unresolved === "missing_dob") {
    // Scoped to the long-term layer on purpose. Short-term coverage is built
    // from `policy.shortTerm` alone and never consults a date of birth, so it
    // still resolves and the projection still pays it — a blanket "this policy
    // pays nothing" contradicts the short-term band rendered right above.
    return {
      tone: "crit",
      message:
        "The long-term benefit period ends at an age, but no date of birth is on file for the insured. Long-term coverage pays nothing until one is added.",
    };
  }
  if (c.seam?.kind === "gap") {
    return {
      tone: "warn",
      message: `${c.seam.months.toFixed(1)} months with no benefit between short-term and long-term coverage.`,
    };
  }
  if (c.seam?.kind === "overlap") {
    const pct = combinedPct(c);
    return {
      tone: "warn",
      message: `Both policies pay for ${c.seam.months.toFixed(1)} months${
        pct === null ? "" : ` — a combined ${pct}% of earnings`
      }.`,
    };
  }
  return null;
}

function CoverageAlert({
  tone,
  message,
  role,
}: {
  tone: "crit" | "warn";
  message: string;
  role: "alert" | "status";
}) {
  return (
    <p
      role={role}
      className={
        tone === "crit"
          ? "rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-[13px] text-crit"
          : "rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn"
      }
    >
      {message}
    </p>
  );
}

/** The swatch mirrors the band's lane, so the legend reads without colour. */
function LegendRow({
  lane,
  swatchClass,
  swatchStyle,
  label,
  detail,
  amount,
}: {
  lane: "top" | "bottom" | "full";
  swatchClass?: string;
  swatchStyle?: CSSProperties;
  label: string;
  detail: string;
  amount: string;
}) {
  const laneClass =
    lane === "top" ? "top-0 h-1/2" : lane === "bottom" ? "bottom-0 h-1/2" : "inset-y-0";
  return (
    <li className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="relative inline-block h-3.5 w-6 shrink-0 rounded-[3px] border border-hair bg-paper"
      >
        <span
          className={["absolute inset-x-0", laneClass, swatchClass].filter(Boolean).join(" ")}
          style={swatchStyle}
        />
      </span>
      <span className="text-ink-2">{label}</span>
      <span className="tabular text-[11px] text-ink-3">{detail}</span>
      <span className="tabular ml-auto text-ink">{amount}</span>
    </li>
  );
}

export function DisabilityCoverageTimeline({
  coverage,
  alertRole = "alert",
}: {
  coverage: ResolvedCoverage;
  /** Live-region role for the coverage warning. A screen may hold at most ONE
   *  `role="alert"`, most-blocking first, so a host that is already showing a
   *  MORE blocking alert — the dialog's failed-save message — passes "status"
   *  and this warning stays on screen without competing for the live region.
   *  The branch reads the VALUE; nothing here tests whether the prop was
   *  supplied. */
  alertRole?: "alert" | "status";
}) {
  const { shortTerm, longTerm } = coverage;
  const alert = coverageAlert(coverage);

  const lastMonth = Math.max(shortTerm?.endMonth ?? 0, longTerm?.endMonth ?? 0);
  const spanMonths = Math.min(MAX_BAR_MONTHS, lastMonth);

  // An LTD-only policy whose benefit period cannot resolve leaves BOTH windows
  // null, so the span is 0 and every percentage would be NaN — a bar drawn from
  // garbage. There is no coverage to draw; show the warning on its own.
  if (spanMonths <= 0) return alert ? <CoverageAlert {...alert} role={alertRole} /> : null;

  const firstBenefitMonth = Math.min(
    shortTerm?.startMonth ?? Infinity,
    longTerm?.startMonth ?? Infinity,
  );

  const clamp = (m: number) => Math.max(0, Math.min(spanMonths, m));
  const band = (start: number, end: number): CSSProperties => ({
    left: `${(clamp(start) / spanMonths) * 100}%`,
    width: `${((clamp(end) - clamp(start)) / spanMonths) * 100}%`,
  });

  return (
    <div className="space-y-3">
      <div
        data-testid="coverage-bar"
        className="relative h-10 w-full overflow-hidden rounded-md border border-hair bg-card-2"
      >
        {firstBenefitMonth > 0 && (
          <div className="absolute inset-y-0" style={{ ...band(0, firstBenefitMonth), ...HATCH }} />
        )}
        {shortTerm !== null && (
          <div
            className="absolute top-0 h-1/2 rounded-sm bg-data-blue"
            style={band(shortTerm.startMonth, shortTerm.endMonth)}
          />
        )}
        {longTerm !== null && (
          <div
            className="absolute bottom-0 h-1/2 rounded-sm bg-data-teal"
            style={band(longTerm.startMonth, longTerm.endMonth)}
          />
        )}
        {lastMonth > MAX_BAR_MONTHS && (
          // On its own the "…" sat on the band, and `text-ink-3` over
          // `bg-data-teal` is 1.03:1 in light theme / 1.91:1 in dark — below
          // even the 3:1 non-text floor, so the one mark telling a sighted
          // advisor the bar is truncated was invisible. Contrast is a ratio of
          // two known tokens, not something only a browser can see. The opaque
          // track-coloured chip is 7.61:1 / 11.67:1.
          <span
            aria-hidden="true"
            className="absolute right-1 top-1/2 flex h-4 -translate-y-1/2 items-center rounded-[3px] border border-hair bg-card-2 px-1 leading-none text-ink-2"
          >
            …
          </span>
        )}
      </div>

      <ul className="space-y-1 text-[13px]">
        {firstBenefitMonth > 0 && (
          <LegendRow
            lane="full"
            swatchStyle={HATCH}
            label="Waiting"
            detail={`${Math.round(firstBenefitMonth * DAYS_PER_MONTH)} days`}
            amount="no benefit"
          />
        )}
        {shortTerm !== null && (
          <LegendRow
            lane="top"
            swatchClass="bg-data-blue"
            label="Short-term"
            detail={`months ${fmtMonths(shortTerm.startMonth)}–${fmtMonths(shortTerm.endMonth)}`}
            amount={`${money.format(shortTerm.monthlyBenefit)}/mo`}
          />
        )}
        {longTerm !== null && (
          <LegendRow
            lane="bottom"
            swatchClass="bg-data-teal"
            label="Long-term"
            detail={`months ${fmtMonths(longTerm.startMonth)}–${fmtMonths(longTerm.endMonth)}`}
            amount={`${money.format(longTerm.monthlyBenefit)}/mo`}
          />
        )}
      </ul>

      {alert && <CoverageAlert {...alert} role={alertRole} />}
    </div>
  );
}
