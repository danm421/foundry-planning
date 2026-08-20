import type { EarlyYearsRothPageOptions } from "./types";

export function summarizeEarlyYearsRothOptions(o: EarlyYearsRothPageOptions): string {
  return o.tidbits.length === 0
    ? "no tidbits"
    : `${o.tidbits.length} tidbit${o.tidbits.length > 1 ? "s" : ""}`;
}
