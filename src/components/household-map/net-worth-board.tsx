"use client";

import Link from "next/link";
import MapCard from "./map-card";
import PersonNode from "./person-node";
import { useScenarioPreservingHref } from "@/hooks/use-scenario-preserving-href";
import { moneyLabel } from "@/lib/household-map/format";
import type { BoardCallbacks, HouseholdMapProps, MapItem } from "@/lib/household-map/types";

/** account/liability/policy → the Net Worth detail page; income/savings/expense
 *  → Inflows & Outflows. Flow-kind items only ever land here via the tray (an
 *  entity-owned rental property's income, say), never via a column — Step 2's
 *  filter keeps them out of the columns entirely. */
function isNetWorthKind(kind: MapItem["kind"]): boolean {
  return kind !== "income" && kind !== "savings" && kind !== "expense";
}

/**
 * The Net Worth board: a flow-chart header (person nodes → "Jointly Held"
 * bracket → connectors) over three ownership columns with running subtotals,
 * plus a tray for anything owned by a trust, business, or family member other
 * than the two principals.
 */
export default function NetWorthBoard({
  clientId,
  people,
  items,
  canEdit,
  onAddAccount,
}: HouseholdMapProps & BoardCallbacks) {
  // Both the columns and the tray navigate; an active `?scenario=` must ride
  // along or a scenario-active Map drops the advisor on the BASE balance sheet.
  const withScenario = useScenarioPreservingHref();
  const hasSpouse = people.spouse !== null;
  const COLUMNS = hasSpouse
    ? (["client", "joint", "spouse"] as const)
    : (["client", "joint"] as const);

  // Local to this board — no other Household Map board needs these labels.
  function labelFor(col: "client" | "joint" | "spouse"): string {
    if (col === "client") return people.client.firstName || "Client";
    if (col === "spouse") return people.spouse?.firstName || "Spouse";
    return hasSpouse ? "Jointly Held" : "Joint";
  }

  // Local to this board — cards only ever need these two destinations.
  function detailHrefFor(item: MapItem): string {
    if (!isNetWorthKind(item.kind)) {
      return withScenario(`/clients/${clientId}/details/income-expenses`);
    }
    return withScenario(`/clients/${clientId}/details/net-worth`);
  }

  const trayItems = items.filter((i) => i.column === "tray" && isNetWorthKind(i.kind));

  return (
    <div className="flex flex-col gap-3">
      {/* Step 1 — header: person nodes, bracket, connectors */}
      <div className="relative flex flex-col items-center pb-1">
        <div className="flex justify-center gap-10">
          <PersonNode person={people.client} />
          {people.spouse && <PersonNode person={people.spouse} />}
        </div>
        {people.children.length > 0 && (
          <div className="absolute right-0 top-0 flex gap-1.5">
            {people.children.map((child, i) => (
              <div key={child.familyMemberId ?? `child-${i}`} className="origin-top scale-75">
                <PersonNode person={child} />
              </div>
            ))}
          </div>
        )}
      </div>

      {hasSpouse && (
        <>
          <div className="mx-auto h-3 w-[170px] rounded-b-lg border border-t-0 border-hair" />
          <div className="mt-1 text-center text-[9px] tracking-wide text-ink-4">Jointly Held</div>
        </>
      )}
      <div className="mx-auto h-3 w-0 border-l border-hair" />
      <div className={hasSpouse ? "mx-[16.6%] border-t border-hair" : "mx-[25%] border-t border-hair"} />
      <div
        data-testid="net-worth-legs"
        className={hasSpouse ? "grid grid-cols-3" : "grid grid-cols-2"}
      >
        {COLUMNS.map((col) => (
          <span key={col} className="mx-auto h-3.5 w-0 border-l border-hair" />
        ))}
      </div>

      {/* Step 2 — three (or two) ownership columns with subtotals */}
      <div className={hasSpouse ? "grid grid-cols-3 gap-4" : "grid grid-cols-2 gap-4"}>
        {COLUMNS.map((col) => {
          const cards = items.filter((i) => i.column === col && isNetWorthKind(i.kind));
          const subtotal = cards.reduce((s, c) => s + c.value, 0);
          return (
            <div key={col} data-testid={`column-${col}`} className="flex flex-col gap-1.5">
              <div className="mb-0.5 text-center text-[9px] font-bold uppercase tracking-wider text-ink-4">
                {labelFor(col)}
              </div>
              {/* Cards LINK to the Net Worth detail page rather than opening
                  AddAccountDialog/BusinessDialog in place. Those dialogs save a
                  ~38-field full-row replace built from `AccountFormInitial`
                  (see `accountToInitial` in balance-sheet-view.tsx), which
                  merges engine rows, base rows and the `account_owners` join —
                  strictly more than this board's account view carries, so any
                  field it couldn't hydrate would be written back as the form's
                  default. The balance sheet already routes business rows to
                  BusinessDialog, so linking delegates instead of duplicating. */}
              {cards.map((c) => (
                <Link key={c.id} href={detailHrefFor(c)} className="group">
                  <MapCard item={c} />
                </Link>
              ))}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => onAddAccount?.()}
                  className="rounded-md border border-dashed border-hair px-2 py-1 text-center text-[10px] text-ink-3 hover:text-ink-2"
                >
                  + Add
                </button>
              )}
              <div className="mt-0.5 border-t border-hair pt-1.5 text-right text-[10px] text-ink-3">
                {labelFor(col)} · <b className="text-ink">{moneyLabel(subtotal)}</b>
              </div>
            </div>
          );
        })}
      </div>

      {/* Step 3 — tray: entity/business/other-family-member-owned items */}
      {trayItems.length > 0 && (
        <div data-testid="tray" className="mt-3 border-t border-dashed border-hair pt-2.5">
          <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-ink-4">
            Held by trusts, businesses &amp; other family members
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {trayItems.map((c) => (
              <Link key={c.id} href={detailHrefFor(c)} className="group">
                <MapCard item={c} />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
