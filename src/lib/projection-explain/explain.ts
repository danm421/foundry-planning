// src/lib/projection-explain/explain.ts
// Adapter-driven DELTA assembly: validate the year pair, run the subject's diff +
// detector battery, attach estimated impacts, rank causes, and emit the
// model-facing payload. Metric-agnostic — the SubjectAdapter supplies the
// figure, degraded figure, detectors, diff, rate, and subject-specific extras.
import type { ProjectionYear } from "@/engine/types";
import {
  LINE_FLOOR, MATERIALITY, money,
  type AnalysisContext, type Cause, type DollarDelta, type DrillContext,
  type Explanation, type Finding, type SubjectAdapter, type Unavailable,
} from "./types";

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

export function explainChange(args: ExplainChangeArgs): Explanation | Unavailable {
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

  return {
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
}
