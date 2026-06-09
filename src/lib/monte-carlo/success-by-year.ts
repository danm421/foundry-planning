/**
 * For each year index, fraction of trials whose liquid-asset value strictly
 * exceeds `threshold`. Matches the count semantics already used inline in
 * `longevity-chart.tsx` (`> requiredMinimumAssetLevel`).
 */
export function successByYear(
  byYearLiquidAssetsPerTrial: number[][],
  threshold: number,
): number[] {
  const trialCount = byYearLiquidAssetsPerTrial.length;
  if (trialCount === 0) return [];
  const yearCount = byYearLiquidAssetsPerTrial[0].length;
  const out: number[] = [];
  for (let y = 0; y < yearCount; y++) {
    let above = 0;
    for (let t = 0; t < trialCount; t++) {
      if (byYearLiquidAssetsPerTrial[t][y] > threshold) above++;
    }
    out.push(above / trialCount);
  }
  return out;
}
