// src/lib/tax/explain-tax-change/explain.ts
// Assembly: validate the year pair, run the diff + detector battery, attach
// estimated tax impacts, rank causes, and emit the model-facing payload.
import type { ProjectionYear } from "@/engine/types";
import type { CellDrillContext } from "@/lib/tax/cell-drill/types";
import { diffTaxYears } from "./diff";
import { DETECTORS } from "./detectors";
import {
  LINE_FLOOR, MATERIALITY, money,
  type TaxChangeCause, type TaxChangeExplanation, type TaxChangeUnavailable,
} from "./types";

export interface ExplainTaxChangeArgs {
  years: ProjectionYear[];
  firstDeathYear: number | null;
  secondDeathYear: number | null;
  year: number;
  compareYear?: number;
  ctx: CellDrillContext;
}

export function explainTaxChange(
  args: ExplainTaxChangeArgs,
): TaxChangeExplanation | TaxChangeUnavailable {
  const compareYear = args.compareYear ?? args.year - 1;
  const next = args.years.find((y) => y.year === args.year);
  const prev = args.years.find((y) => y.year === compareYear);

  if (!next || !prev) {
    const first = args.years[0]?.year;
    const last = args.years[args.years.length - 1]?.year;
    const missing = !next ? args.year : compareYear;
    return {
      available: false,
      reason: `Year ${missing} is outside the projection (${first}–${last}). Ask about a year in that range.`,
      availableYears: first != null && last != null ? { first, last } : undefined,
    };
  }

  if (!prev.taxResult || !next.taxResult) {
    return {
      available: true,
      degraded: true,
      year: args.year,
      compareYear,
      headline: {
        totalTax: {
          label: "Total tax",
          from: Math.round(prev.expenses.taxes),
          to: Math.round(next.expenses.taxes),
          delta: Math.round(next.expenses.taxes - prev.expenses.taxes),
        },
      },
      notes: [
        "Detailed tax breakdown is unavailable for one of these years (flat-mode fallback or missing tax detail); totals come from expenses.taxes. Cause attribution is not possible.",
      ],
    };
  }

  const diff = diffTaxYears(prev, next, args.ctx);
  const dArgs = {
    prev, next, diff, ctx: args.ctx,
    firstDeathYear: args.firstDeathYear, secondDeathYear: args.secondDeathYear,
  };
  const findings = DETECTORS.map((d) => d(dArgs)).filter(
    (f): f is NonNullable<typeof f> => f != null,
  );

  const totalDelta = diff.headline.totalTax.delta;
  const causes: TaxChangeCause[] = [];
  let attributed = 0;
  for (const f of findings) {
    if (f.kind === "filing_status_change") continue;
    const est =
      f.kind === "state_move"
        ? diff.headline.stateTax.delta
        : Math.round(f.incomeDelta * diff.blendedRate);
    attributed += est;
    causes.push({ ...f, estimatedTaxImpact: est });
  }
  // Filing-status change is a rate-structure effect: assign it the residual
  // the income-side causes don't explain, rather than pretending precision.
  const fs = findings.find((f) => f.kind === "filing_status_change");
  if (fs) causes.push({ ...fs, estimatedTaxImpact: totalDelta - attributed });
  causes.sort((a, b) => Math.abs(b.estimatedTaxImpact) - Math.abs(a.estimatedTaxImpact));

  const notes: string[] = [
    `estimatedTaxImpact values are approximations (income-side delta × ~${Math.round(diff.blendedRate * 100)}% blended incremental rate); exact tax-side changes are in taxLineDeltas, exact income-side dollars in sourceDeltas.`,
  ];
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
    available: true,
    year: args.year,
    compareYear,
    headline: diff.headline,
    taxLineDeltas: diff.taxLineDeltas,
    incomeDeltas: diff.incomeDeltas,
    sourceDeltas: diff.sourceDeltas,
    causes,
    withdrawalPicture: diff.withdrawalPicture,
    marginalFederalRate: diff.marginalFederalRate,
    noSignificantChange: noSignificantChange || undefined,
    notes,
  };
}
