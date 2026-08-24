import { EARLY_YEARS_MAX_MILESTONE_AGES } from "../early-years-detail";
import type { EarlyYearsWaitingPageData } from "./types";

export function estimateEarlyYearsWaitingPageCount(data: EarlyYearsWaitingPageData): number {
  return Math.max(
    1,
    Math.ceil(data.groups.length / EARLY_YEARS_MAX_MILESTONE_AGES),
  );
}
