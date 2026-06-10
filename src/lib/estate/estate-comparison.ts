import type { ClientData, ProjectionYear } from "@/engine/types";
import {
  buildYearlyEstateReport,
  type Ordering,
  type YearlyEstateRow,
} from "./yearly-estate-report";

export interface EstateBuckets {
  toHeirs: number;
  taxesAndExpenses: number;
  toCharity: number;
}

export interface EstateComparison {
  year: number;
  base: EstateBuckets;
  proposed: EstateBuckets;
  /** proposed − base, per bucket. */
  deltas: EstateBuckets;
}

const ZERO: EstateBuckets = { toHeirs: 0, taxesAndExpenses: 0, toCharity: 0 };

/** Map a yearly-estate-report row to the three chart buckets. The chart shows
 *  the report's own values verbatim, so the chart reconciles with the estate
 *  reports by construction. */
export function bucketsFromRow(row: YearlyEstateRow): EstateBuckets {
  return {
    toHeirs: row.totalToHeirs,
    taxesAndExpenses: row.taxesAndExpenses,
    toCharity: row.charity,
  };
}

/** Exact-year row if present; otherwise the nearest row at or before `year`;
 *  otherwise the first row. Null only for an empty report. */
export function pickRowForYear(
  rows: YearlyEstateRow[],
  year: number,
): YearlyEstateRow | null {
  if (rows.length === 0) return null;
  const exact = rows.find((r) => r.year === year);
  if (exact) return exact;
  let best: YearlyEstateRow | null = null;
  for (const r of rows) {
    if (r.year <= year && (best == null || r.year > best.year)) best = r;
  }
  return best ?? rows[0];
}

export function diffBuckets(
  base: EstateBuckets,
  proposed: EstateBuckets,
): EstateBuckets {
  return {
    toHeirs: proposed.toHeirs - base.toHeirs,
    taxesAndExpenses: proposed.taxesAndExpenses - base.taxesAndExpenses,
    toCharity: proposed.toCharity - base.toCharity,
  };
}

export interface BuildEstateComparisonArgs {
  baseProjection: ProjectionYear[];
  proposedProjection: ProjectionYear[];
  baseTree: ClientData;
  proposedTree: ClientData;
  ordering: Ordering;
  year: number;
  ownerNames: { clientName: string; spouseName: string | null };
  ownerDobs: { clientDob: string | null; spouseDob: string | null };
}

/** Build the Base-vs-Proposed estate distribution comparison for a chosen
 *  death year and ordering. Reuses buildYearlyEstateReport for both sides so
 *  the numbers match the estate reports exactly. */
export function buildEstateComparison(
  args: BuildEstateComparisonArgs,
): EstateComparison {
  const {
    baseProjection,
    proposedProjection,
    baseTree,
    proposedTree,
    ordering,
    year,
    ownerNames,
    ownerDobs,
  } = args;

  const baseReport = buildYearlyEstateReport({
    projection: { years: baseProjection },
    clientData: baseTree,
    ordering,
    ownerNames,
    ownerDobs,
  });
  const proposedReport = buildYearlyEstateReport({
    projection: { years: proposedProjection },
    clientData: proposedTree,
    ordering,
    ownerNames,
    ownerDobs,
  });

  const baseRow = pickRowForYear(baseReport.rows, year);
  const proposedRow = pickRowForYear(proposedReport.rows, year);
  const base = baseRow ? bucketsFromRow(baseRow) : ZERO;
  const proposed = proposedRow ? bucketsFromRow(proposedRow) : ZERO;

  return { year, base, proposed, deltas: diffBuckets(base, proposed) };
}
