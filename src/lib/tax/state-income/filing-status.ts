import type { FilingStatus } from "@/lib/tax/types";
import type { FilingStatusMap, StateFilingStatus } from "./types";

const DEFAULT_MAP: Record<FilingStatus, StateFilingStatus> = {
  married_joint: "joint",
  single: "single",
  head_of_household: "single",
  married_separate: "single",
};

export function mapFilingStatus(
  fs: FilingStatus,
  override?: FilingStatusMap,
): StateFilingStatus {
  return override?.[fs] ?? DEFAULT_MAP[fs];
}
