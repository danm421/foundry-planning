"use client";

import { useCallback, useMemo, useState } from "react";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { YearRange } from "@/lib/comparison/layout-schema";

interface UseYearRangeArgs {
  plans: ComparisonPlan[];
  initialYearRange: YearRange | null;
}

export interface UseYearRangeApi {
  yearRange: YearRange | null;
  min: number;
  max: number;
  setYearRange: (next: YearRange | null) => void;
  reset: () => void;
}

function clampRange(
  range: YearRange | null,
  min: number,
  max: number,
): YearRange | null {
  if (!range) return null;
  if (range.end < min || range.start > max) return null;
  const start = Math.max(range.start, min);
  const end = Math.min(range.end, max);
  if (start > end) return null;
  return { start, end };
}

export function useYearRange({
  plans,
  initialYearRange,
}: UseYearRangeArgs): UseYearRangeApi {
  const { min, max } = useMemo(() => {
    const allYears = plans.flatMap((p) => p.result.years.map((y) => y.year));
    if (allYears.length === 0) {
      const yr = new Date().getFullYear();
      return { min: yr, max: yr };
    }
    return { min: Math.min(...allYears), max: Math.max(...allYears) };
  }, [plans]);

  const [yearRange, setYearRangeState] = useState<YearRange | null>(() =>
    clampRange(initialYearRange, min, max),
  );

  const setYearRange = useCallback(
    (next: YearRange | null) => setYearRangeState(clampRange(next, min, max)),
    [min, max],
  );

  const reset = useCallback(() => setYearRangeState(null), []);

  return { yearRange, min, max, setYearRange, reset };
}
