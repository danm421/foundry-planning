import { ROTH_DETAIL_MAX_ROWS } from "../early-years-detail";
import type { EarlyYearsRothPageData } from "./types";

export function estimateEarlyYearsRothPageCount(data: EarlyYearsRothPageData): number {
  return Math.max(1, Math.ceil(data.detailRows.length / ROTH_DETAIL_MAX_ROWS));
}
