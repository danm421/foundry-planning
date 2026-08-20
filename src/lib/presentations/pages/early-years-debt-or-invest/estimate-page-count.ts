import { DEBT_OR_INVEST_DETAIL_MAX_ROWS } from "../early-years-detail";
import type { EarlyYearsDebtOrInvestPageData } from "./types";

export function estimateEarlyYearsDebtOrInvestPageCount(
  data: EarlyYearsDebtOrInvestPageData,
): number {
  return Math.max(1, Math.ceil(data.detailRows.length / DEBT_OR_INVEST_DETAIL_MAX_ROWS));
}
