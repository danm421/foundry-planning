import type { EarlyYearsLadderPageOptions } from "./types";

export function summarizeEarlyYearsLadderOptions(o: EarlyYearsLadderPageOptions): string {
  const rungs =
    o.rungs.mode === "relative"
      ? o.rungs.offsets.map((v) => (v === 0 ? "current" : `+${Math.round(v * 100)}pp`)).join(" / ")
      : o.rungs.percents.map((v) => `${Math.round(v * 100)}%`).join(" / ");
  const ages = `ages ${o.milestoneAges.join("/")}`;
  const tid =
    o.tidbits.length === 0
      ? "no tidbits"
      : `${o.tidbits.length} tidbit${o.tidbits.length > 1 ? "s" : ""}`;
  return `${rungs} · ${ages} · ${tid}`;
}
