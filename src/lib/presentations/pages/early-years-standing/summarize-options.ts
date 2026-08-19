import type { EarlyYearsStandingPageOptions } from "./types";

export function summarizeEarlyYearsStandingOptions(o: EarlyYearsStandingPageOptions): string {
  const match = o.showMatchLine ? "with match line" : "no match line";
  const tid =
    o.tidbits.length === 0
      ? "no tidbits"
      : `${o.tidbits.length} tidbit${o.tidbits.length > 1 ? "s" : ""}`;
  return `${match} · ${tid}`;
}
