import { EARLY_YEARS_MAX_MILESTONE_AGES } from "../early-years-detail";
import type { EarlyYearsLadderPageData } from "./types";

export function estimateEarlyYearsLadderPageCount(data: EarlyYearsLadderPageData): number {
  return Math.max(
    1,
    Math.ceil(data.groups.length / EARLY_YEARS_MAX_MILESTONE_AGES),
  );
}
