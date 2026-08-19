"use client";

// Client shell for Organizer → Cash Flow. The portal counterpart of
// `household-map-view.tsx`: it owns editor state and supplies the board's
// callbacks. It is NOT a copy of that file — there is no scenario writer, no
// quick-edit drawer, and no Social Security dialog here, because the portal
// writes base only and routes every editable row through one small panel.
//
// ⚠️ NO PAGE-LEVEL ADD BAR, and that is a ruling, not an omission. The board
// renders its own "Add income" / "Add savings" / "Add expense" — one per band —
// and gates them on `canEdit` ALONE, so (unlike `GoalsBoard`) withholding the
// callback cannot suppress them and a page header bar would sit a second "Add
// income" a few pixels from the first. `variant="portal"` is what makes the
// band buttons full-size; wiring `onAddFlow` is what makes them work.

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import CashFlowBoard from "@/components/household-map/cash-flow-board";
import {
  OrganizerFlowFormPanel,
  type FlowFormTarget,
} from "@/components/portal/organizer-flow-form-panel";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import type { OrganizerMapData } from "@/lib/portal/load-organizer-map";
import type { MapItem } from "@/lib/household-map/types";

const COLLECTION = {
  income: "incomes",
  expense: "expenses",
  savings: "savings-rules",
} as const;

export default function OrganizerCashFlowClient({
  data,
}: {
  data: OrganizerMapData;
}): ReactElement {
  const [target, setTarget] = useState<FlowFormTarget | null>(null);
  const portalFetch = usePortalFetch();
  const router = useRouter();

  /**
   * Permission AND per-row writability, the same two-part test the advisor Map
   * applies. Membership in the hydration maps is the probe — those maps are
   * already filtered by the portal predicates server-side
   * (`lib/portal/portal-flow-writable.ts`). The extra `column !== "tray"` check
   * lives here rather than in the loader because `column` is a property of the
   * CARD, not of the row: the same expense would be writable if it were not
   * entity-owned.
   */
  function isItemEditable(item: MapItem): boolean {
    if (item.column === "tray") return false;
    if (item.kind === "income") return item.id in data.incomeRows;
    if (item.kind === "expense") return item.id in data.expenseRows;
    if (item.kind === "savings") return item.id in data.savingsRuleRows;
    return false;
  }

  function handleEditItem(item: MapItem) {
    if (!data.canEdit || !isItemEditable(item)) return;
    if (item.kind === "income") {
      setTarget({ kind: "income", id: item.id, row: data.incomeRows[item.id] });
    } else if (item.kind === "expense") {
      setTarget({ kind: "expense", id: item.id, row: data.expenseRows[item.id] });
    } else if (item.kind === "savings") {
      setTarget({ kind: "savings", id: item.id, row: data.savingsRuleRows[item.id] });
    }
  }

  /** The board reports the column its button sat in; the portal panel has no
   *  column preset to seed with it (an income's Owner select defaults to the
   *  client), so it is accepted and ignored rather than threaded through. */
  function handleAddFlow(kind: "income" | "expense" | "savings") {
    if (!data.canEdit) return;
    setTarget({ kind, id: null, row: null } as FlowFormTarget);
  }

  /**
   * The card's click-to-edit amount. A narrow PUT is safe here in a way it never
   * is on the advisor side: the portal writes BASE, and the base routes are
   * partial patches, so sending one field changes exactly one column. (The
   * advisor's equivalent has to send the whole row because a scenario write
   * replaces the change payload wholesale.)
   */
  async function handleSaveFlowAmount(item: MapItem, next: number): Promise<boolean> {
    if (!data.canEdit || !isItemEditable(item)) return false;
    const collection = COLLECTION[item.kind as keyof typeof COLLECTION];
    if (!collection) return false;

    const res = await portalFetch(`/api/portal/${collection}/${item.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ annualAmount: String(next) }),
    });
    if (res.ok) router.refresh();
    return res.ok;
  }

  return (
    <>
      {/*
        The board is a spreadsheet: one `minmax(0,1fr)` track per owner. Each
        card's trailing group is `shrink-0` and ~143px wide (a fixed 74px timing
        cell plus the amount), so below roughly 260px of track the cards stop
        fitting — the name's `truncate` collapses it to ZERO width and the cards
        spill past the grid. Measured at 390x844 before this wrapper: the
        document scrolled to 462px and all seven card names rendered at 0px.

        So the board scrolls inside its own container instead of dragging the
        page sideways, which is the house pattern for wide content. `min-w` is
        what actually stops the crush — `overflow-x-auto` alone would still let
        the tracks shrink to 75px. The number is 3 x ~265px of track + 2 x 8px of
        column gap + the band panel's own 2 x 12px padding + this 2 x 20px — 875,
        rounded up. It was 960 while the board still carried a 100px label
        gutter, which the `portal` variant drops.
      */}
      <div className="overflow-x-auto">
        <div className="min-w-[880px] p-5">
          <CashFlowBoard
            variant="portal"
            people={data.people}
            items={data.items}
            canEdit={data.canEdit}
            onEditItem={handleEditItem}
            onAddFlow={(kind) => handleAddFlow(kind)}
            onSaveFlowAmount={handleSaveFlowAmount}
            isItemEditable={isItemEditable}
          />
        </div>
      </div>

      {target && (
        <OrganizerFlowFormPanel
          key={`${target.kind}:${target.id ?? "new"}`}
          target={target}
          clientFirstName={data.people.client.firstName}
          spouseFirstName={data.people.spouse?.firstName ?? null}
          savingsAccountOptions={data.savingsAccountOptions}
          milestones={data.milestones}
          onClose={() => setTarget(null)}
          onSaved={() => setTarget(null)}
        />
      )}
    </>
  );
}
