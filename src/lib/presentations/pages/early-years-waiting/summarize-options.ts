import type { EarlyYearsWaitingPageOptions } from "./types";

export function summarizeEarlyYearsWaitingOptions(o: EarlyYearsWaitingPageOptions): string {
  const rate = `+${Math.round(o.rungOffset * 100)}pp`;
  const starts = o.delays.map((d) => (d === 0 ? "now" : `+${d}y`)).join(" / ");
  const ages = `ages ${o.milestoneAges.join("/")}`;
  const tid =
    o.tidbits.length === 0
      ? "no tidbits"
      : `${o.tidbits.length} tidbit${o.tidbits.length > 1 ? "s" : ""}`;
  return `${rate} · ${starts} · ${ages} · ${tid}`;
}
