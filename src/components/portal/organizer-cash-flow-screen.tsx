import type { ReactElement } from "react";
import CashFlowBoard from "@/components/household-map/cash-flow-board";
import { loadOrganizerMap } from "@/lib/portal/load-organizer-map";

/**
 * Organizer → Cash Flow. Income / Savings / Expenses crossed with owner
 * columns, from the same builder the advisor Household Map uses.
 *
 * READ-ONLY in this phase. `canEdit={false}` is passed literally rather than
 * from `data.canEdit`: the board gates its add buttons, its pencils AND its
 * inline amount editors on that one flag, and there is no write route behind
 * them until the next plan. Passing the real flag would render affordances that
 * silently discard the edit.
 */
export default async function OrganizerCashFlowScreen({
  clientId,
}: {
  clientId: string;
}): Promise<ReactElement> {
  const data = await loadOrganizerMap(clientId);

  if (!data) {
    return (
      <div className="p-5 text-[13px] text-ink-3">
        Your cash flow map isn&apos;t ready yet — your advisor is still setting up
        your plan.
      </div>
    );
  }

  return (
    <div className="p-5">
      <CashFlowBoard people={data.people} items={data.items} canEdit={false} />
    </div>
  );
}
