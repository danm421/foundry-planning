import type { MedicareDetector } from "./types";

export const rmdEraTierWarning: MedicareDetector = ({ years, rmdStartAges }) => {
  const rmdStartAge = rmdStartAges.client;

  const pre: Array<{ year: number; tier: number; surcharge: number }> = [];
  const post: Array<{ year: number; tier: number; surcharge: number }> = [];

  for (const y of years) {
    const detail = y.medicare?.client;
    if (!detail || !detail.enrolled) continue;
    const surcharge = detail.partBIrmaaSurcharge + detail.partDIrmaaSurcharge;
    const row = { year: y.year, tier: detail.irmaaTier, surcharge };
    if (detail.age >= rmdStartAge) post.push(row);
    else if (detail.age >= 60) pre.push(row);
  }

  if (post.length === 0 || pre.length === 0) return null;

  const avg = (arr: Array<{ tier: number }>) =>
    arr.reduce((s, r) => s + r.tier, 0) / arr.length;

  const preAvgTier = avg(pre);
  const postAvgTier = avg(post);

  if (postAvgTier < 2) return null;
  if (postAvgTier - preAvgTier < 1) return null;

  const totalSurchargeOverWindow = post.reduce((s, r) => s + r.surcharge, 0);
  const firstPostYear = post[0]!.year;
  const lastPostYear = post[post.length - 1]!.year;

  return {
    id: "rmd-era",
    severity: "info",
    title: `RMD-era IRMAA risk — $${Math.round(totalSurchargeOverWindow).toLocaleString()} surcharge ${firstPostYear}–${lastPostYear}`,
    body: `RMDs starting age ${rmdStartAge} (${firstPostYear}) push the household to tier 2 or higher every year through ${lastPostYear}. Cumulative IRMAA surcharge: $${Math.round(totalSurchargeOverWindow).toLocaleString()}. Consider Roth conversions before age ${rmdStartAge - 1} to reduce future RMDs.`,
    impactedYears: post.map(r => r.year),
    totalSurchargeOverWindow,
  };
};
