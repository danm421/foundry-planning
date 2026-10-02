import type { ClientData } from "@/engine/types";
import { buildClientMilestones, resolveMilestone, type YearRef } from "@/lib/milestones";

/** Milestones of the tree being shown. Inside a scenario these are the
 *  SCENARIO's (a retirement-age change moves them), never the base plan's. */
export function treeMilestones(tree: Pick<ClientData, "client" | "planSettings">) {
  return buildClientMilestones(tree.client, tree.planSettings.planStartYear, tree.planSettings.planEndYear);
}

/**
 * Withdrawal-order rows with their milestone-anchored years re-resolved against
 * `milestones` (display only: a read never writes). Returns copies.
 */
export function withdrawalRowsForDisplay(
  rows: NonNullable<ClientData["withdrawalStrategy"]>,
  milestones: ReturnType<typeof treeMilestones>,
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
