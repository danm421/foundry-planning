import type { EarlyYearsHumanCapitalPageOptions } from "./types";

export function summarizeEarlyYearsHumanCapitalOptions(
  o: EarlyYearsHumanCapitalPageOptions,
): string {
  return o.tidbits.length === 0
    ? "no tidbits"
    : `${o.tidbits.length} tidbit${o.tidbits.length > 1 ? "s" : ""}`;
}
