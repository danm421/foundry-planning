import type { ClientData } from "@/engine/types";
import { resolveMilestone, type ClientMilestones, type YearRef } from "@/lib/milestones";

/**
 * Withdrawal-order rows with their milestone-anchored years re-resolved against
 * `milestones` (display only: a read never writes). Returns copies.
 */
export function withdrawalRowsForDisplay(
  rows: NonNullable<ClientData["withdrawalStrategy"]>,
  milestones: ClientMilestones,
) {
  return rows.map((w) => {
    const row = { ...w, id: w.id! };
    if (row.startYearRef) {
      const resolved = resolveMilestone(row.startYearRef as YearRef, milestones, "start");
      if (resolved != null) row.startYear = resolved;
    }
    if (row.endYearRef) {
      const resolved = resolveMilestone(row.endYearRef as YearRef, milestones, "end");
      if (resolved != null) row.endYear = resolved;
    }
    return row;
  });
}
