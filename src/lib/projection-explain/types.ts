// src/lib/projection-explain/types.ts
// Generic, subject-agnostic payload types for the projection-explanation engine.
// Pure — no IO. Tax-specific delta shapes live in subjects/tax-diff.ts.
import type { CellDrillContext } from "@/lib/tax/cell-drill/types";
import type { ProjectionYear, SavingsRule } from "@/engine/types";

/** Hide delta lines smaller than this (noise floor). */
export const LINE_FLOOR = 100;
/** Cap on bySource delta rows returned to the model. */
export const SOURCE_CAP = 12;
/** Cap on the top LEVEL drivers (componentBreakdown sorted by |amount|). Smaller
 *  than SOURCE_CAP: a focused "what's driving this level vs the reference" set,
 *  not the full breakdown (which the payload already carries in full). */
export const DRIVER_CAP = 6;
/** An account ledger ending below this is treated as depleted. */
export const DEPLETED_EPS = 100;
/** |Δ headline figure| below this ⇒ "no significant change". */
export const MATERIALITY = 500;
/** Household blended-ratio move (in points) that fires fundingCharacterShift. */
export const RATIO_SHIFT_POINTS = 0.1;
/** A 401k/403b counts as Roth-designated when its BoY Roth slice exceeds this
 *  fraction of beginning value. */
export const ROTH_SLICE_MIN = 0.05;

export const money = (n: number) =>
  `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
export const pct = (r: number) => `${Math.round(r * 100)}%`;

export interface DollarDelta {
  label: string;
  from: number;
  to: number;
  delta: number;
}

/** Rounded from/to/delta triple — the one DollarDelta factory (assembly + diff
 *  layers share it so rounding can never diverge between them). */
export const dd = (label: string, from: number, to: number): DollarDelta => ({
  label,
  from: Math.round(from),
  to: Math.round(to),
  delta: Math.round(to - from),
});

/** A labeled, source-keyed part of a figure (COMPOSITION). */
export interface Component {
  label: string;
  amount: number;
  sourceId?: string;
  type?: string;
}

export type SubjectKey = "tax"; // widened in Phase 2 by registering more adapters

/** Generic cause finding — assembly attaches estimatedImpact. */
export interface Finding {
  kind: string;
  summary: string;
  /** Exact income-side dollars from ledger/bySource data, signed. 0 for rate-structure causes. */
  incomeDelta: number;
  evidence: Record<string, number | string | boolean>;
  /** Optional structured extras (e.g. per-account funding rows, provenance). */
  detail?: Record<string, unknown>;
}
export interface Cause extends Finding {
  estimatedImpact: number;
}

/** Shared context for all subjects: source-label lookups + provenance maps. */
export interface DrillContext extends CellDrillContext {
  savingsRules: SavingsRule[];
  /** account.id → DB rothValue at plan start (seed Roth). Together with the
   *  Roth-designated savingsRules, this is the ENTIRE per-account Roth-slice
   *  provenance the engine tracks for 401k/403b accounts — there is no in-plan
   *  Roth-rollover flag (see subjects/tax-provenance.ts). */
  accountSeedRoth: Record<string, number>;
}

export interface CauseDetector {
  (args: DetectorArgs): Finding | null;
}

/** Detector input. `diff` is the subject's own delta shape (tax: TaxYearDiff),
 *  typed `unknown` here and narrowed inside the adapter's detectors. */
export interface DetectorArgs {
  prev: ProjectionYear;
  next: ProjectionYear;
  diff: unknown;
  ctx: DrillContext;
  firstDeathYear: number | null;
  secondDeathYear: number | null;
}

export interface SubjectAdapter {
  key: SubjectKey;
  /** Human label for the headline figure, e.g. "Total tax". */
  figureLabel: string;
  /** Headline number for a year; null when the substrate is missing (degrade). */
  figure(year: ProjectionYear): number | null;
  /** Degraded headline when figure() is null (e.g. tax → expenses.taxes). */
  degradedFigure(year: ProjectionYear): number;
  /** Labeled, source-keyed parts of the figure for one year (COMPOSITION). */
  components(year: ProjectionYear, ctx: DrillContext): Component[];
  /** Ordered cause detectors (DELTA). */
  detectors: CauseDetector[];
  /** Builds the subject's delta shape passed to detectors + merged into DELTA output. */
  buildDiff(prev: ProjectionYear, next: ProjectionYear, ctx: DrillContext): unknown;
  /** Incremental rate translating an income-side delta into an estimated figure impact. */
  estimateRate(diff: unknown): number;
  /** Subject-specific detail merged verbatim into DELTA output (tax: taxLineDeltas etc.). */
  deltaExtras(diff: unknown): Record<string, unknown>;
}

export interface Explanation {
  available: true;
  /** True when one year lacks the figure substrate — headline only, degraded source. */
  degraded?: boolean;
  subject: SubjectKey;
  year: number;
  compareYear: number;
  headline: { figure: DollarDelta };
  componentBreakdown?: Component[];
  causes?: Cause[];
  noSignificantChange?: boolean;
  /** Set by cliff auto-location (Task 7) when the asked boundary is nearly flat
   *  but a much larger |Δfigure| sits within two years of it — the boundary the
   *  advisor probably meant, already explained. */
  probableIntendedJump?: {
    boundary: string;
    headline: { figure: DollarDelta };
    causes?: Cause[];
    withdrawalPicture?: unknown;
    /** The located cliff's own top-level notes (reversal confirmation, IRMAA
     *  second-order). Typed explicitly — the Explanation index signature would
     *  otherwise widen this to `unknown` — so consumers see the string array. */
    notes?: string[];
  };
  analysisContext: AnalysisContext;
  notes: string[];
  /** Subject-specific pictures merged from adapter.deltaExtras (tax: taxLineDeltas, …). */
  [k: string]: unknown;
}
/** COMPOSITION payload (Task 8): a single year's figure decomposed into labeled,
 *  source-keyed parts. A level, not a delta — `figure` is the scalar year value
 *  (degradedFigure when the substrate is missing), `boundaryAnalyzed` names the
 *  one year, and there is no compareYear. */
export interface Composition {
  available: true;
  /** True when the year lacks the figure substrate — a single degraded total, no parts. */
  degraded?: boolean;
  subject: SubjectKey;
  year: number;
  figure: number;
  componentBreakdown: Component[];
  /** LEVEL comparison (Task 9): why this year's figure is high/low vs a
   *  reference. Present only when `compareTo` is not `"none"` and a reference
   *  resolved (a degraded year or an unresolvable reference emits a note
   *  instead). `reference` is the reference kind (or the year as a string for a
   *  named-year comparison); `delta` = figure(year) − referenceFigure; `drivers`
   *  are the top componentBreakdown parts by |amount|. Typed explicitly (not via
   *  an index signature) so consumers see the shape. */
  level?: {
    reference: string;
    referenceFigure: number;
    delta: number;
    drivers: Component[];
  };
  analysisContext: AnalysisContext;
  notes: string[];
}
export interface Unavailable {
  available: false;
  reason: string;
  availableYears?: { first: number; last: number };
}
export interface AnalysisContext {
  scenarioId: string | null;
  scenarioName?: string;
  subject: SubjectKey;
  boundaryAnalyzed: string; // "2062→2063"
  probableIntendedBoundary?: string; // set by cliff auto-location (Task 7)
  planYearRange: { first: number; last: number };
  materialityThreshold: number;
}
