export interface PresetWindows {
  full: [number, number];
  working: [number, number] | null;
  retirement: [number, number] | null;
}

/**
 * Compute the three preset windows for the year-range slider.
 *
 * Rules:
 * - full: always [planStart, planEnd]
 * - working: [planStart, retirementYear - 1] when retirementYear > planStart;
 *            null when retirementYear is null, ≤ planStart
 * - retirement: [retirementYear, planEnd] when retirementYear ≤ planEnd;
 *               null when retirementYear is null or > planEnd
 *
 * Edge cases:
 * - retirementYear at planStart → working = null, retirement = full
 * - retirementYear at planEnd → working = [planStart, planEnd - 1], retirement = [planEnd, planEnd]
 * - retirementYear before planStart → working = null, retirement = full
 *   (advisor's retirement was before the plan started, so the whole plan is retirement)
 */
export function computePresets(
  planStartYear: number,
  planEndYear: number,
  clientRetirementYear: number | null
): PresetWindows {
  const full: [number, number] = [planStartYear, planEndYear];

  if (clientRetirementYear === null) {
    return { full, working: null, retirement: null };
  }

  if (clientRetirementYear <= planStartYear) {
    // Retired at or before plan starts → entire plan is retirement
    return { full, working: null, retirement: full };
  }

  if (clientRetirementYear > planEndYear) {
    // Retires after plan ends → entire plan is working years
    return { full, working: full, retirement: null };
  }

  return {
    full,
    working: [planStartYear, clientRetirementYear - 1],
    retirement: [clientRetirementYear, planEndYear],
  };
}

/**
 * Check whether the current range exactly matches a given preset window.
 * Returns false when the preset is null (i.e., not available for this client).
 */
export function isPresetActive(
  current: [number, number],
  preset: [number, number] | null
): boolean {
  if (preset === null) return false;
  return current[0] === preset[0] && current[1] === preset[1];
}

/**
 * Clamp a range to [min, max] bounds. Swaps from/to if from > to (defensive,
 * since Radix can return values in either order during dragging edge cases).
 */
export function clampRange(
  range: [number, number],
  min: number,
  max: number
): [number, number] {
  let [from, to] = range;
  if (from > to) [from, to] = [to, from];
  from = Math.max(min, Math.min(max, from));
  to = Math.max(min, Math.min(max, to));
  return [from, to];
}

/**
 * Generate evenly-spaced year labels for the slider's axis.
 * Always includes min and max as the first and last labels.
 *
 * - For span >= targetCount: returns targetCount evenly-spaced ints
 * - For span < targetCount: returns every year between min and max inclusive (deduped)
 */
export function computeAxisLabels(
  min: number,
  max: number,
  targetCount: number = 8
): number[] {
  if (min === max) return [min];

  const span = max - min;
  if (span < targetCount) {
    const labels: number[] = [];
    for (let y = min; y <= max; y++) labels.push(y);
    return labels;
  }

  const labels: number[] = [];
  for (let i = 0; i < targetCount; i++) {
    const ratio = i / (targetCount - 1);
    labels.push(Math.round(min + ratio * span));
  }
  // Force exact endpoints (rounding might shift them by 1)
  labels[0] = min;
  labels[labels.length - 1] = max;
  return labels;
}
