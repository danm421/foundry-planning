import { EARLY_YEARS_GROUPED_DETAIL_MAX_ROWS } from "../early-years-detail";
import type { EarlyYearsLadderPageData } from "./types";

export function estimateEarlyYearsLadderPageCount(data: EarlyYearsLadderPageData): number {
  const rows = data.groups.reduce((total, group) => total + group.bars.length, 0);
  return Math.max(1, Math.ceil(rows / EARLY_YEARS_GROUPED_DETAIL_MAX_ROWS));
}
