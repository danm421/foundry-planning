// src/lib/projection-explain/explain.ts
// Adapter-driven DELTA assembly: validate the year pair, run the subject's diff +
// detector battery, attach estimated impacts, rank causes, and emit the
// model-facing payload. Metric-agnostic — the SubjectAdapter supplies the
// figure, degraded figure, detectors, diff, rate, and subject-specific extras.
import type { ProjectionYear } from "@/engine/types";
import {
  LINE_FLOOR, MATERIALITY, money,
  type AnalysisContext, type Cause, type Composition, type DollarDelta, type DrillContext,
  type Explanation, type Finding, type SubjectAdapter, type Unavailable,
} from "./types";
import { composeYear } from "./operations";
// Subject-honest branch (see the reversal cross-check below): gated on
// `adapter.key === "tax"`, mirroring the state_move special-case. The mirror's
// ratio direction reuses the Task-4 detector verbatim rather than re-deriving
// the prior-funder-set ratio logic here.
import { detectFundingCharacterShift } from "./subjects/tax-detectors";
import type { TaxYearDiff } from "./subjects/tax-diff";

export interface ExplainChangeArgs {
  adapter: SubjectAdapter;
  years: ProjectionYear[];
  firstDeathYear: number | null;
  secondDeathYear: number | null;
  year: number;
  compareYear?: number;
  ctx: DrillContext;
}

function dd(label: string, from: number, to: number): DollarDelta {
  return { label, from: Math.round(from), to: Math.round(to), delta: Math.round(to - from) };
}

export function explainChange(
  args: ExplainChangeArgs,
  // Internal recursion guard for cliff auto-location — NOT part of the public
  // tool surface. The scan below re-invokes explainChange on the cliff boundary
  // with depth+1; that inner call must skip the scan (it would land on the same
  // cliff, whose localMax === requested, so no further recursion, but the guard
  // makes non-recursion structural rather than incidental).
  depth = 0,
): Explanation | Unavailable {
  const { adapter } = args;
  const compareYear = args.compareYear ?? args.year - 1;
  const next = args.years.find((y) => y.year === args.year);
  const prev = args.years.find((y) => y.year === compareYear);

  const first = args.years[0]?.year;
  const last = args.years[args.years.length - 1]?.year;

  if (!next || !prev) {
    const missing = !next ? args.year : compareYear;
    return {
      available: false,
      reason: `Year ${missing} is outside the projection (${first}–${last}). Ask about a year in that range.`,
      availableYears: first != null && last != null ? { first, last } : undefined,
    };
  }

  const analysisContext: AnalysisContext = {
    scenarioId: null,
    subject: adapter.key,
    boundaryAnalyzed: `${compareYear}→${args.year}`,
    planYearRange: { first: first ?? args.year, last: last ?? args.year },
    materialityThreshold: MATERIALITY,
  };

  // Degrade FIRST: when the figure substrate is missing on either year the diff +
  // detectors (which deref the substrate) can't run — headline only, no causes.
  if (adapter.figure(next) == null || adapter.figure(prev) == null) {
    return {
      available: true,
      degraded: true,
      subject: adapter.key,
      year: args.year,
      compareYear,
      headline: {
        figure: dd(adapter.figureLabel, adapter.degradedFigure(prev), adapter.degradedFigure(next)),
      },
      analysisContext,
      notes: [
        "Detailed tax breakdown is unavailable for one of these years (flat-mode fallback or missing tax detail); totals come from expenses.taxes. Cause attribution is not possible.",
      ],
    };
  }

  const diff = adapter.buildDiff(prev, next, args.ctx);
  const findings: Finding[] = adapter.detectors
    .map((d) =>
      d({
        prev, next, diff, ctx: args.ctx,
        firstDeathYear: args.firstDeathYear, secondDeathYear: args.secondDeathYear,
      }),
    )
    .filter((f): f is Finding => f != null);

  const headlineFigure = dd(adapter.figureLabel, adapter.figure(prev)!, adapter.figure(next)!);
  const totalDelta = headlineFigure.delta;
  const rate = adapter.estimateRate(diff);

  // Phase-0 parity: state_move's estimate is the EXACT state-tax delta (its
  // incomeDelta is 0), which the tax diff carries on headline.stateTax. Read it
  // structurally so a subject whose diff lacks that shape falls back to the
  // income-side estimate. Mirrors the retained filing_status_change special-case.
  const stateTaxDelta = (diff as { headline?: { stateTax?: { delta?: number } } })
    .headline?.stateTax?.delta;

  const causes: Cause[] = [];
  let attributed = 0;
  for (const f of findings) {
    if (f.kind === "filing_status_change") continue;
    const est =
      f.kind === "state_move" && typeof stateTaxDelta === "number"
        ? stateTaxDelta
        : Math.round(f.incomeDelta * rate);
    attributed += est;
    causes.push({ ...f, estimatedImpact: est });
  }
  // Filing-status change is a rate-structure effect: assign it the residual
  // the income-side causes don't explain, rather than pretending precision.
  const fs = findings.find((f) => f.kind === "filing_status_change");
  if (fs) causes.push({ ...fs, estimatedImpact: totalDelta - attributed });
  causes.sort((a, b) => Math.abs(b.estimatedImpact) - Math.abs(a.estimatedImpact));

  const notes: string[] = [
    `estimatedImpact values are approximations (income-side delta × ~${Math.round(rate * 100)}% blended incremental rate); exact tax-side changes are in taxLineDeltas, exact income-side dollars in sourceDeltas.`,
  ];
  if (fs) {
    notes.push(
      "The filing_status_change cause's estimatedImpact is an unattributed residual " +
        "(total tax change minus the income-side cause estimates), not a direct bracket " +
        "calculation — it can be small, large, or even negative, and may absorb income " +
        "movements no specific cause detected.",
    );
  }
  const noSignificantChange = Math.abs(totalDelta) < MATERIALITY;
  if (noSignificantChange) {
    notes.push(`Total tax changed by only ${money(totalDelta)} between ${compareYear} and ${args.year} — no significant change to explain.`);
  }

  // Second-order: IRMAA's 2-year MAGI lookback — this year's income moves
  // Medicare premiums two years out.
  const nPlus1 = args.years.find((y) => y.year === args.year + 1);
  const nPlus2 = args.years.find((y) => y.year === args.year + 2);
  const irmaaRise =
    (nPlus2?.medicare?.totalIrmaaSurcharge ?? 0) - (nPlus1?.medicare?.totalIrmaaSurcharge ?? 0);
  if (nPlus2 && irmaaRise >= LINE_FLOOR) {
    notes.push(
      `Second-order effect: Medicare IRMAA uses a 2-year MAGI lookback — ${args.year}'s income affects premiums in ${args.year + 2}, where the projected IRMAA surcharge rises ${money(irmaaRise)}.`,
    );
  }

  // Reversal cross-check (refinement E): when the top cause is a funding-character
  // shift — draws moving toward taxable sources, spiking tax — a genuine mechanism
  // reverses when its driver reverses. Scan the whole projection for the largest
  // opposite-sign (tax-falling) boundary and confirm its blended funding ratio
  // swings back toward tax-free before citing it as confirmation. Subject-honest:
  // tax-only, and silent when no such mirror exists. Runs AFTER the degrade guard,
  // so `causes` reflect a real diff.
  const cliff = causes[0];
  if (
    adapter.key === "tax" &&
    cliff?.kind === "funding_character_shift" &&
    totalDelta > 0 &&
    Number(cliff.evidence.blendedRatioYear) > Number(cliff.evidence.blendedRatioPriorYear)
  ) {
    let mirror: { prevYear: ProjectionYear; nextYear: ProjectionYear; figure: number; delta: number } | null = null;
    for (let i = 0; i + 1 < args.years.length; i++) {
      const py = args.years[i];
      const ny = args.years[i + 1];
      if (py.year === compareYear && ny.year === args.year) continue; // the cliff isn't its own mirror
      const pf = adapter.figure(py);
      const nf = adapter.figure(ny);
      if (pf == null || nf == null) continue; // skip degraded (figure-less) years
      const delta = nf - pf;
      if (delta >= 0) continue; // opposite the rising cliff ⇒ a tax fall
      if (!mirror || delta < mirror.delta) mirror = { prevYear: py, nextYear: ny, figure: nf, delta };
    }
    if (mirror) {
      const mirrorFinding = detectFundingCharacterShift({
        prev: mirror.prevYear,
        next: mirror.nextYear,
        diff: adapter.buildDiff(mirror.prevYear, mirror.nextYear, args.ctx) as TaxYearDiff,
        ctx: args.ctx,
        firstDeathYear: args.firstDeathYear,
        secondDeathYear: args.secondDeathYear,
      });
      if (
        mirrorFinding &&
        Number(mirrorFinding.evidence.blendedRatioYear) < Number(mirrorFinding.evidence.blendedRatioPriorYear)
      ) {
        notes.push(
          `Mechanism confirmed by the ${mirror.prevYear.year}–${mirror.nextYear.year} reversal ` +
            `(draws shift back toward tax-free sources; total tax falls to ${money(mirror.figure)}).`,
        );
      }
    }
  }

  const result: Explanation = {
    ...adapter.deltaExtras(diff),
    available: true,
    subject: adapter.key,
    year: args.year,
    compareYear,
    headline: { figure: headlineFigure },
    causes,
    noSignificantChange: noSignificantChange || undefined,
    analysisContext,
    notes,
  };

  // Cliff auto-location (refinement A): the advisor may have asked about a
  // boundary one row off the real jump — e.g. "why did tax spike in 2063?" when
  // the spike is actually 2061→2062 and 2062→2063 is flat. Scan the whole range
  // for the largest |Δfigure| within two years of the asked boundary; if it
  // dwarfs the asked boundary's delta, explain THAT boundary and attach it as
  // probableIntendedJump. Runs on BOTH the significant and no-significant-change
  // paths (this is exactly the flat-asked-boundary case the feature exists for),
  // but AFTER the degrade guard — the degraded path returned above without
  // dereferencing subject internals. Depth-guarded so the recursive explain of
  // the cliff can't itself recurse.
  if (depth === 0) {
    // degradedFigure() backfills years whose figure substrate is missing, so a
    // gap in the middle of the range never derails the scan.
    const figs = args.years.map((y) => ({ year: y.year, v: adapter.figure(y) ?? adapter.degradedFigure(y) }));
    const boundaries = figs.slice(1).map((f, i) => ({
      from: figs[i].year, to: f.year, absDelta: Math.abs(f.v - figs[i].v),
    }));
    const requested = boundaries.find((b) => b.from === compareYear && b.to === args.year);
    const window = boundaries.filter((b) => Math.abs(b.to - args.year) <= 2);
    const localMax = window.reduce((m, b) => (b.absDelta > m.absDelta ? b : m), window[0]);
    const requestedDelta = requested?.absDelta ?? 0;
    if (localMax && localMax !== requested && localMax.absDelta >= Math.max(3 * requestedDelta, 10_000)) {
      const alt = explainChange({ ...args, year: localMax.to, compareYear: localMax.from }, depth + 1);
      if (alt.available) {
        result.probableIntendedJump = {
          boundary: `${localMax.from}→${localMax.to}`,
          headline: alt.headline,
          causes: alt.causes,
          withdrawalPicture: alt.withdrawalPicture,
        };
        result.analysisContext.probableIntendedBoundary = `${localMax.from}→${localMax.to}`;
        result.notes.push(
          `The asked boundary ${compareYear}→${args.year} is nearly flat; the real jump is ` +
            `${localMax.from}→${localMax.to}. Lead with that and name both boundaries.`,
        );
      }
    }
  }

  return result;
}

/** A LEVEL reference the COMPOSITION tool can carry. Only `"none"` (pure
 *  composition) is in scope for Task 8; the other references — prior_year,
 *  plan_average, working_years, or a specific year — are Task 9's LEVEL branch. */
export type CompareTo = "none" | "prior_year" | "plan_average" | "working_years" | number;

export interface ExplainCompositionArgs {
  adapter: SubjectAdapter;
  years: ProjectionYear[];
  year: number;
  compareTo?: CompareTo;
  ctx: DrillContext;
}

/** COMPOSITION assembly: decompose ONE year's figure into labeled, source-keyed
 *  parts. Metric-agnostic — the adapter supplies figure, degradedFigure, and
 *  components. Unavailable when the year is outside the projection.
 *
 *  compareTo staging (Task 8): only the pure-composition path (`"none"`/omitted)
 *  is implemented. A non-none `compareTo` is a LEVEL request (Task 9); rather than
 *  crash or silently ignore, run the composition and push a note that
 *  level-comparison isn't available yet. Task 9 replaces this branch. */
export function explainComposition(args: ExplainCompositionArgs): Composition | Unavailable {
  const { adapter } = args;
  const target = args.years.find((y) => y.year === args.year);
  const first = args.years[0]?.year;
  const last = args.years[args.years.length - 1]?.year;

  if (!target) {
    return {
      available: false,
      reason: `Year ${args.year} is outside the projection (${first}–${last}). Ask about a year in that range.`,
      availableYears: first != null && last != null ? { first, last } : undefined,
    };
  }

  const analysisContext: AnalysisContext = {
    scenarioId: null,
    subject: adapter.key,
    boundaryAnalyzed: `${args.year}`, // single year — a level, not a "prev→next" delta
    planYearRange: { first: first ?? args.year, last: last ?? args.year },
    materialityThreshold: MATERIALITY,
  };

  const componentBreakdown = composeYear(adapter, target, args.ctx);
  const figureVal = adapter.figure(target);
  const degraded = figureVal == null;

  const notes: string[] = [];
  if (degraded) {
    notes.push(
      "Detailed tax breakdown is unavailable for this year (flat-mode fallback or missing tax detail); the total comes from expenses.taxes and is not decomposed into tax lines or income sources.",
    );
  } else {
    notes.push(
      "componentBreakdown has two families: tax_line parts (the pieces of the tax bill — they sum to Total tax) and income_source parts (the recognized income DRIVING the tax — never add these to the tax total).",
    );
  }

  // compareTo staging — the LEVEL branch (why the level is high/low vs a
  // reference) lands in Task 9. Degrade honestly for a non-none request.
  if (args.compareTo != null && args.compareTo !== "none") {
    notes.push(
      `Level comparison (compareTo: ${JSON.stringify(args.compareTo)}) is not yet available for this request; returning the pure composition of ${args.year} only.`,
    );
  }

  // Second-order effect: this year's income also drives Medicare IRMAA two years
  // out (2-year MAGI lookback). Emit only from engine-emitted data — the projected
  // year+2 surcharge — and only when it's material and the year isn't degraded.
  const nPlus2 = args.years.find((y) => y.year === args.year + 2);
  const irmaaN2 = nPlus2?.medicare?.totalIrmaaSurcharge ?? 0;
  if (!degraded && nPlus2 && irmaaN2 >= LINE_FLOOR) {
    notes.push(
      `Second-order effect: Medicare IRMAA uses a 2-year MAGI lookback — ${args.year}'s income also drives the projected ${money(irmaaN2)} IRMAA surcharge in ${args.year + 2}.`,
    );
  }

  return {
    available: true,
    degraded: degraded || undefined,
    subject: adapter.key,
    year: args.year,
    figure: degraded ? adapter.degradedFigure(target) : figureVal,
    componentBreakdown,
    analysisContext,
    notes,
  };
}
