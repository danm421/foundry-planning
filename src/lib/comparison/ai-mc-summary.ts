import type { ComparisonPlan } from "./build-comparison-plans";
import type { McSharedResult } from "./widgets/types";

export interface McAiPlanSummary {
  planId: string;
  label: string;
  successRate: number;
  ending: {
    p5: number;
    p20: number;
    p50: number;
    p80: number;
    p95: number;
    min: number;
    max: number;
    mean: number;
  };
  /** Sparse percentile bands — first year, every ~5 years, last year.
   *  Lets the model reference the spread at key points without exploding the payload. */
  byYear: Array<{
    year: number;
    age: number;
    p5: number;
    p50: number;
    p95: number;
  }>;
}

/** Build AI-friendly Monte Carlo summaries keyed by plan id. Returns null
 *  when MC data isn't available — caller should omit `mcByPlan` from the
 *  request body in that case. */
export function buildMcAiSummaries(
  plans: ComparisonPlan[],
  mc: McSharedResult | null,
): McAiPlanSummary[] | null {
  if (!mc || mc.perPlan.length === 0) return null;
  const out: McAiPlanSummary[] = [];
  for (let i = 0; i < mc.perPlan.length; i++) {
    const planId = plans[i]?.id;
    if (!planId) continue;
    const p = mc.perPlan[i];
    const byYearRaw = p.summary?.byYear ?? [];
    const sparse = sparsifyByYear(byYearRaw);
    out.push({
      planId,
      label: p.label,
      successRate: p.successRate,
      ending: {
        p5: p.summary.ending.p5,
        p20: p.summary.ending.p20,
        p50: p.summary.ending.p50,
        p80: p.summary.ending.p80,
        p95: p.summary.ending.p95,
        min: p.summary.ending.min,
        max: p.summary.ending.max,
        mean: p.summary.ending.mean,
      },
      byYear: sparse.map((row) => ({
        year: row.year,
        age: row.age.client,
        p5: row.balance.p5,
        p50: row.balance.p50,
        p95: row.balance.p95,
      })),
    });
  }
  return out.length > 0 ? out : null;
}

function sparsifyByYear<T extends { year: number }>(rows: T[]): T[] {
  if (rows.length === 0) return [];
  if (rows.length <= 8) return rows;
  const picked: T[] = [rows[0]];
  const stride = 5;
  for (let i = stride; i < rows.length - 1; i += stride) {
    picked.push(rows[i]);
  }
  picked.push(rows[rows.length - 1]);
  return picked;
}
