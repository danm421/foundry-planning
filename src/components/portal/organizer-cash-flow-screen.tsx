import type { ReactElement } from "react";
import { loadOrganizerMap } from "@/lib/portal/load-organizer-map";
import OrganizerCashFlowClient from "@/components/portal/organizer-cash-flow-client";

/**
 * Organizer → Cash Flow. Income / Savings / Expenses crossed with owner
 * columns, from the same builder the advisor Household Map uses.
 *
 * A loader and nothing else: it fetches, handles the not-ready state, and hands
 * the data to the client shell that owns the editor. `canEdit` now comes from
 * the DATA rather than a hardcoded `false` — the write routes behind the board's
 * affordances exist as of this branch. The board's own layout wrapper moved into
 * the client component, next to the markup its comment explains.
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

  return <OrganizerCashFlowClient data={data} />;
}
