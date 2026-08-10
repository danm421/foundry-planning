import type { RiskAlignment } from "@/lib/insights/risk-capacity";
import type { MismatchState } from "@/lib/risk/portfolio-mismatch";
import type { OverviewLifeEvent } from "@/lib/overview/derive-life-events";
import type { Finding } from "@/lib/tax-analysis/types";
import type { RiskLevel } from "@/lib/risk-levels";
import type { BindingConstraint } from "@/lib/risk/scoring";
// Type-only, so it is erased at compile time and the signal rules keep no
// runtime edge to the module's `@/db` import.
import type { LargestPosition } from "../largest-position";

export type SignalSeverity = "critical" | "opportunity" | "watch" | "info";
export type SignalDomain = "risk" | "tax" | "plan" | "portfolio" | "relationship";

/**
 * One graded, evidence-carrying observation about a household.
 *
 * `id` is a CONTRACT, not a label: it is what the AI layer cites in an action
 * and what a persisted action references after the fact. Renaming one
 * invalidates stored actions silently.
 */
export interface Signal {
  /** "<domain>.<rule>", snake_case after the dot. */
  id: string;
  domain: SignalDomain;
  severity: SignalSeverity;
  /** Advisor-worded and deterministic. Never model-generated. */
  title: string;
  /** One sentence, figures already interpolated. */
  detail: string;
  /** The evidence behind the sentence. */
  numbers: Record<string, number>;
  /** Deep link into the app, or null when there is nowhere useful to go. */
  href: string | null;
  /** Dollars, for ordering within a severity. Null sorts last. */
  estimatedImpact: number | null;
}

/**
 * Everything the pure rules read. Assembled once by `loadInsightsBattery` —
 * the rules themselves do no IO and read no clock, so every one of them is
 * testable with a plain object and a fixed `now`.
 */
export interface SignalInput {
  clientId: string;
  now: Date;
  risk: {
    alignment: RiskAlignment;
    toleranceScore: number | null;
    toleranceConfirmedAt: Date | null;
    compositeLevel: RiskLevel | null;
    bindingConstraint: BindingConstraint;
    mismatch: MismatchState;
  };
  plan: {
    mcSuccessRate: number | null;
    liquidPortfolio: number;
    /** Positive = outflow exceeds inflow this year. */
    currentYearNetOutflow: number;
    /** Smallest projected year-end net worth across the plan. */
    minNetWorth: number;
    fundingScore: number;
    /** False when the projection failed or produced no years. `minNetWorth`
     *  and `fundingScore` then hold fallbacks, not projected results, and no
     *  plan rule may speak as if a projection had run. */
    hasProjection: boolean;
  };
  portfolio: {
    /** 0..1 share of the allocation rollup sitting in cash. */
    cashPct: number;
    /**
     * Dollar total the allocation rollup was taken over — i.e. only accounts
     * carrying an asset mix. `cashPct`'s denominator, and therefore the ONLY
     * base a cash-dollar figure may be multiplied against. Deliberately not
     * `liquidPortfolio`, which sums a different set of accounts entirely.
     */
    allocatedTotal: number;
    /** Real geometric returns from the firm CMA. */
    cashReturn: number;
    equityReturn: number;
    /** Largest single position aggregated across accounts, or null. Carries its
     *  own holdings-derived denominator — see LargestPosition. */
    largestPosition: LargestPosition | null;
  };
  relationship: {
    /** `crmHouseholds.id`, NOT the planning `clients.id`. The CRM deep links
     *  resolve `/crm/households/[id]` against this table, and the two uuids are
     *  never equal — passing the client id 404s every one of those links. */
    crmHouseholdId: string;
    overdueTaskCount: number;
    lastContactAt: Date | null;
    portalInvitedAt: Date | null;
    portalFirstLoginAt: Date | null;
    lifeEvents: OverviewLifeEvent[];
    /** Plan-relative "today". Life-event proximity is measured against this,
     *  NOT the calendar — the projection is anchored to a persisted
     *  planStartYear and has no wall-clock input. */
    planStartYear: number;
  };
  tax: {
    findings: Finding[];
    /** Tax year of the return the findings came from; null = none on file. */
    taxYear: number | null;
  };
}
