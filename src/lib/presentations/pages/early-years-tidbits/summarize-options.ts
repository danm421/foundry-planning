import type { EarlyYearsTidbitsPageOptions } from "./types";

export function summarizeEarlyYearsTidbitsOptions(
  o: EarlyYearsTidbitsPageOptions,
): string {
  return o.tidbits.length === 0
    ? "no tidbits"
    : `${o.tidbits.length} tidbit${o.tidbits.length > 1 ? "s" : ""}`;
}
