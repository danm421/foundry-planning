"use client";

import Link from "next/link";
import MapCard from "./map-card";
import GrowthRateCell from "@/components/forms/growth-rate-cell";
// The app has no lucide dependency — icons are hand-rolled SVGs in
// `components/icons.tsx`, which is where the rest of this board's glyphs come
// from. The plan called for lucide's Pencil; this is the same glyph.
import { PencilIcon, PlusIcon } from "@/components/icons";
import { InlineAmount } from "@/components/forms/inline-amount";
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
  accountRows,
  growthContext,
  categoryDefaultRates,
  resolvedInflationRate,
  onAddAccount,
  onSaveAccountField,
  onEditAccount,
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

  /** The rate chip for a card, or null when the item has no growth to show.
   *  Liabilities fall out automatically — they have no `accountRows` entry.
   *  Policies are excluded explicitly: they DO have a row, but they are out of
   *  scope for the Map. `stock_options` is NOT excluded — display is universal
   *  even where editing is not. */
  function rateSlotFor(item: MapItem) {
    const row = accountRows[item.id];
    if (!row || row.category === "life_insurance") return null;
    return (
      <GrowthRateCell
        row={row}
        growthContext={growthContext}
        categoryDefaultRates={categoryDefaultRates}
        // The SCENARIO-EFFECTIVE rate, not `growthContext.resolvedInflationRate`
        // — that one is loaded against the base scenario id. See the prop's doc
        // comment on GrowthRateCell.
        resolvedInflationRate={resolvedInflationRate}
        canEdit={canEdit && onSaveAccountField != null}
        onSave={(patch) => onSaveAccountField!(item.id, patch)}
      />
    );
  }

  /** The inline value editor, or null to fall back to the plain label. Gated on
   *  all three of: a hydrated row (liabilities have none), edit permission, and
   *  a save handler — a board rendered standalone in a test has no writer, and
   *  an editable-looking field that silently discards the edit is worse than a
   *  read-only one. */
  function valueSlotFor(item: MapItem) {
    const row = accountRows[item.id];
    if (!row || !canEdit || !onSaveAccountField) return null;
    return (
      <InlineAmount
        amount={Number(row.value)}
        label={item.name}
        onSave={(next) => onSaveAccountField(item.id, { value: String(next) })}
        className="min-w-[72px] rounded-sm px-1 py-0.5 text-right text-xs font-semibold tabular text-ink-2 hover:bg-card hover:ring-1 hover:ring-inset hover:ring-hair-2"
      />
    );
  }

  /** The pencil. Opens the full account editor — the same dialog the balance
   *  sheet uses, hydrated from the same merged row. Only account cards get one:
   *  liabilities and synthesized policy rows have no `accountRows` entry, and
   *  they keep their link instead (see the card loop below). */
  function actionSlotFor(item: MapItem) {
    const row = accountRows[item.id];
    if (!row || !canEdit || !onEditAccount) return null;
    return (
      <button
        type="button"
        aria-label={`Edit ${item.name}`}
        title={`Edit ${item.name}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onEditAccount(item.id);
        }}
        className="text-ink-4 hover:text-accent"
      >
        <PencilIcon width={12} height={12} strokeWidth={1.5} />
      </button>
    );
  }

  /** An account card edits in place; everything else still navigates. */
  function isEditableAccountCard(item: MapItem): boolean {
    return accountRows[item.id] != null && canEdit && onEditAccount != null;
  }

  /** One card, wrapped in a link only when it has nowhere better to go. */
  function renderCard(c: MapItem) {
    // Gated on `isEditableAccountCard`, not just on `onEditAccount`: the cards
    // it excludes are the ones still wrapped in a <Link> below, and a <button>
    // may not nest inside an <a>.
    const editable = isEditableAccountCard(c);
    const card = (
      <MapCard
        item={c}
        rateSlot={rateSlotFor(c)}
        valueSlot={valueSlotFor(c)}
        actionSlot={actionSlotFor(c)}
        // The name opens the same editor the pencil does — a 12px glyph is a
        // small target for the most common action on the board.
        onNameClick={editable ? () => onEditAccount!(c.id) : undefined}
      />
    );
    // Account cards used to link to /details/net-worth because this board could
    // not hydrate the account dialog. It can now — `accountRows` carries the
    // full merged row (lib/accounts/load-account-rows.ts) — so the pencil opens
    // the real editor in place and the link would only fight the inline
    // editors for the click.
    //
    // Liabilities and synthesized policy rows get NO pencil (no hydrated row),
    // so they KEEP the link. Dropping it for every card would leave them inert:
    // no editor, no navigation, nothing.
    if (editable) return <div key={c.id}>{card}</div>;
    return (
      <Link key={c.id} href={detailHrefFor(c)} className="group">
        {card}
      </Link>
    );
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
          <div className="mt-1 text-center text-[10px] tracking-wide text-ink-3">Jointly Held</div>
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
              <div className="mb-0.5 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-2">
                {labelFor(col)}
              </div>
              {/* ABOVE the cards, not below them. At the bottom of a long column
                  the add affordance scrolled out of sight on any household with
                  more than a handful of accounts — it was findable only by
                  reading to the end of the list. It is also a solid-bordered
                  accent button rather than a dashed ink-3 placeholder: this is an
                  action, which is the one thing the brand reserves the accent
                  for. */}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => onAddAccount?.()}
                  className="mb-0.5 flex items-center justify-center gap-1 rounded-md border border-hair-2 bg-card-2 px-2 py-1.5 text-[11px] font-medium text-accent transition-colors hover:border-accent hover:bg-accent-wash"
                >
                  <PlusIcon width={11} height={11} strokeWidth={2} />
                  Add account
                </button>
              )}
              {cards.map(renderCard)}
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
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-2">
            Held by trusts, businesses &amp; other family members
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {trayItems.map(renderCard)}
          </div>
        </div>
      )}
    </div>
  );
}
