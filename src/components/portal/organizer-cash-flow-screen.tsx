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

  // The board is a spreadsheet: a 100px gutter plus one `minmax(0,1fr)` track
  // per owner. Each card's trailing group is `shrink-0` and ~143px wide (a fixed
  // 74px timing cell plus the amount), so below roughly 260px of track the cards
  // stop fitting — the name's `truncate` collapses it to ZERO width and the
  // cards spill past the grid. Measured at 390x844 before this wrapper: the
  // document scrolled to 462px and all seven card names rendered at 0px.
  //
  // So the board scrolls inside its own container instead of dragging the page
  // sideways, which is the house pattern for wide content. `min-w` is what
  // actually stops the crush — `overflow-x-auto` alone would still let the
  // tracks shrink to 75px. The number is 3 x ~265px of track + the 100px gutter
  // + gaps + this padding. It is inert above 960px, so desktop and the advisor
  // preview render exactly as before; `cash-flow-board.tsx` itself is untouched,
  // which keeps the advisor Household Map byte-identical.
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[960px] p-5">
        <CashFlowBoard people={data.people} items={data.items} canEdit={false} />
      </div>
    </div>
  );
}
