import {
  coerceYearRef,
  resolveMilestone,
  type ClientMilestones,
  type YearRef,
} from "@/lib/milestones";

export interface ResolvedTimingField {
  /** Concrete year to write. Undefined = leave the column untouched on update. */
  year?: number;
  /** Ref to write. null = clear the column; undefined = leave untouched on update. */
  ref?: YearRef | null;
}

export interface ResolvedImportTiming {
  start: ResolvedTimingField;
  end: ResolvedTimingField;
}

function resolveSide(
  year: number | undefined,
  rawRef: YearRef | undefined,
  position: "start" | "end",
  milestones: ClientMilestones | undefined,
): ResolvedTimingField {
  const ref = coerceYearRef(rawRef);
  if (ref && milestones) {
    const resolved = resolveMilestone(ref, milestones, position);
    if (resolved != null) return { year: resolved, ref };
  }
  // Ref absent or unresolvable: an explicit manual year wins and clears the ref.
  if (year != null) return { year, ref: null };
  return {};
}

/**
 * Translate an extracted income/expense row's timing into the concrete
 * (year, ref) pairs the commit writes. A resolvable ref drives the year;
 * an explicit manual year clears the ref; an unresolvable ref (missing
 * milestones, or a spouse ref with no spouse) degrades to the year.
 */
export function resolveImportTiming(
  row: { startYear?: number; endYear?: number; startYearRef?: YearRef; endYearRef?: YearRef },
  milestones: ClientMilestones | undefined,
): ResolvedImportTiming {
  return {
    start: resolveSide(row.startYear, row.startYearRef, "start", milestones),
    end: resolveSide(row.endYear, row.endYearRef, "end", milestones),
  };
}
