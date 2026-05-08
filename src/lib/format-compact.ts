/** Compact currency formatter shared across components (e.g. "$4.2M", "$120K", "$999K"). */

/**
 * Compact currency: "$4.2M", "$120K", "$999K", "$1.0M", "$1.0B".
 * Thresholds: >= 999_500 → M branch; >= 999_500_000 → B branch.
 * Values < $1K render as "$X" (full integer, no K suffix).
 * Zero renders as "$0".
 * Negative values render with sign before $: "-$4.2M".
 */
export function formatCompact(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 999_500_000) {
    const b = abs / 1_000_000_000;
    return `${sign}$${b.toFixed(1)}B`;
  }
  if (abs >= 999_500) {
    const m = abs / 1_000_000;
    return `${sign}$${m.toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    const k = abs / 1_000;
    const str = Number.isInteger(k) || k.toFixed(1).endsWith(".0")
      ? k.toFixed(1).replace(/\.0$/, "")
      : k.toFixed(1);
    return `${sign}$${str}K`;
  }
  return `${sign}$${Math.round(abs)}`;
}
