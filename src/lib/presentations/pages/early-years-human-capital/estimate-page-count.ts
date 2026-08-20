import { HUMAN_CAPITAL_DETAIL_MAX_ROWS } from "../early-years-detail";
import type { EarlyYearsHumanCapitalPageData } from "./types";

export function estimateEarlyYearsHumanCapitalPageCount(
  data: EarlyYearsHumanCapitalPageData,
): number {
  return Math.max(1, Math.ceil(data.detailRows.length / HUMAN_CAPITAL_DETAIL_MAX_ROWS));
}
