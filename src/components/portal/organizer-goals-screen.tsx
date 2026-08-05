import type { ReactElement } from "react";
import { loadOrganizerMap } from "@/lib/portal/load-organizer-map";
import OrganizerGoalsClient from "@/components/portal/organizer-goals-client";

/**
 * Organizer → Goals. The same board the advisor sees on the Household Map,
 * fed by the same builder over the same base tree.
 *
 * A loader and nothing else: it fetches, handles the not-ready state, and hands
 * the data to the client shell that owns the editor. `canEdit` and `expenseRows`
 * now come from the DATA — the write routes behind the goal cards exist as of
 * this branch, and membership in `expenseRows` is what decides which cards open
 * an editor.
 *
 * `onSaveLifeExpectancy` stays omitted permanently, not just for this phase.
 * Those cards move the plan horizon (`client.planEndAge` +
 * `planSettings.planEndYear`) and that is an advisor lever — the board falls
 * back to its static detail line.
 */
export default async function OrganizerGoalsScreen({
  clientId,
}: {
  clientId: string;
}): Promise<ReactElement> {
  const data = await loadOrganizerMap(clientId);

  if (!data) {
    return (
      <div className="p-5 text-[13px] text-ink-3">
        Your goals timeline isn&apos;t ready yet — your advisor is still setting up
        your plan.
      </div>
    );
  }

  return <OrganizerGoalsClient data={data} />;
}
