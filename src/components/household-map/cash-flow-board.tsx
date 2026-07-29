"use client";

import MapCard from "./map-card";
import PersonNode from "./person-node";
import { PencilIcon, PlusIcon } from "@/components/icons";
import { InlineAmount } from "@/components/forms/inline-amount";
import { moneyLabel } from "@/lib/household-map/format";
import { coerceYearRef, YEAR_REF_LABELS } from "@/lib/milestones";
import type {
  BoardCallbacks,
  FlowTiming,
  HouseholdMapProps,
  MapColumn,
  MapItem,
} from "@/lib/household-map/types";

// `addLabel` is written out rather than derived from `label`, because the two
// don't line up: the Expenses band is plural and its button adds one expense.
const BANDS = [
  { key: "income", label: "Income", addLabel: "Add income", kinds: ["income"] },
  { key: "savings", label: "Savings", addLabel: "Add savings", kinds: ["savings"] },
  { key: "expense", label: "Expenses", addLabel: "Add expense", kinds: ["expense"] },
] as const;

type OwnerColumn = Exclude<MapColumn, "tray">;

/** "2026-2060", or a single year when the window is one year wide. */
function timingLabel(t: FlowTiming): string {
  return t.startYear === t.endYear ? String(t.startYear) : `${t.startYear}-${t.endYear}`;
}

/**
 * Tooltip for the timing cell. Names the milestone anchor when the row has one,
 * because "2035" and "the year Cooper retires" are the same number until
 * retirement age moves — and only one of them follows it. `coerceYearRef` narrows
 * the persisted string; an unrecognised token degrades to the bare year rather
 * than indexing `YEAR_REF_LABELS` with undefined.
 */
function timingTitle(t: FlowTiming): string {
  const startRef = coerceYearRef(t.startYearRef);
  const endRef = coerceYearRef(t.endYearRef);
  const start = startRef ? `${YEAR_REF_LABELS[startRef]} (${t.startYear})` : String(t.startYear);
  const end = endRef ? `${YEAR_REF_LABELS[endRef]} (${t.endYear})` : String(t.endYear);
  return `Starts ${start} · Ends ${end}`;
}

/**
 * The sign the card's amount is DISPLAYED with. `MapItem.editableAmount` is the
 * unsigned persisted column, so the parens on an outflow have to be reapplied
 * here; `item.value` can't stand in because an unresolvable savings rule carries
 * a literal 0 and would render as an inflow. Exhaustive over the three band
 * kinds, which are the only kinds this board renders.
 */
function displaySign(item: MapItem): 1 | -1 {
  return item.kind === "income" ? 1 : -1;
}

/**
 * The Cash Flow board: three horizontal bands (Income / Savings / Expenses)
 * crossed with owner columns (client / joint / spouse), under one shared
 * avatar header.
 *
 * AMENDED 2026-07-28 (controller ruling, human-approved): Task 7 assigns
 * `column: "tray"` to any income/expense carrying an `ownerEntityId` (an
 * S-corp's income is not the client's personal income) — the three owner
 * columns have nowhere to put that. So each band also renders a full-width
 * tray row beneath its owner columns for that band's `column === "tray"`
 * cards, labelled via each card's `trayOwnerLabel` (MapCard already renders
 * `trayOwnerLabel` as the card's chip). Without this row those cards don't
 * just land in the wrong column — they vanish from the board AND from the
 * band subtotal below, since the subtotal sums every item in the band
 * (columns + tray alike) via the signed `value` contract in
 * `@/lib/household-map/types` (`MapItem.value`): inflows positive, outflows
 * (expenses AND savings contributions) negative, unresolvable savings rules
 * carry `0` and show the rule in `valueLabel` instead.
 */
export default function CashFlowBoard({
  people,
  items,
  canEdit,
  onEditItem,
  onAddFlow,
  onSaveFlowAmount,
  isItemEditable,
}: HouseholdMapProps & BoardCallbacks) {
  const hasSpouse = people.spouse !== null;

  /** Permission AND per-row writability. A row the caller can't write — a
   *  synthesized life-insurance premium, say — must LOOK inert, so it gets
   *  neither the pencil nor the inline editor. Absent `isItemEditable` means
   *  every row is writable (boards render standalone in tests). */
  function isWritable(item: MapItem): boolean {
    return canEdit && (isItemEditable?.(item) ?? true);
  }

  /** The start/end year range. Display-only — editing the window is the drawer's
   *  job, which has the milestone-anchor picker this cell only reports. Fixed
   *  width so the value column still lines up down a board column. */
  function metaSlotFor(item: MapItem) {
    if (!item.timing) return null;
    return (
      <span
        title={timingTitle(item.timing)}
        className="w-[74px] shrink-0 text-right text-[10px] tabular text-ink-3"
      >
        {timingLabel(item.timing)}
      </span>
    );
  }

  /** The inline amount editor, or null to fall back to `item.valueLabel`. Gated
   *  on a writer being present as well as on writability: a board rendered
   *  without `onSaveFlowAmount` must not show a field that silently discards the
   *  edit. `editableAmount` null means there is no single number to edit — an IRS
   *  max or percent-of-pay rule keeps its rule text. */
  function valueSlotFor(item: MapItem) {
    if (item.editableAmount == null || !onSaveFlowAmount || !isWritable(item)) return null;
    const sign = displaySign(item);
    return (
      <InlineAmount
        amount={item.editableAmount}
        label={item.name}
        // The editor holds the unsigned amount; the card keeps showing an outflow
        // in accounting parens, exactly as the read-only label did.
        format={(n) => moneyLabel(sign * n)}
        onSave={(next) => onSaveFlowAmount(item, next)}
        className="min-w-[72px] rounded-sm px-1 py-0.5 text-right text-xs font-semibold tabular text-ink-2 hover:bg-card hover:ring-1 hover:ring-inset hover:ring-hair-2"
      />
    );
  }

  /** The pencil — opens the row's full editor (quick-edit drawer for an
   *  income/expense, `SavingsRuleDialog` for a rule). It replaces the old
   *  whole-card click, which cannot survive an inline editor: a card-level
   *  `<button>` may not contain the editor's own `<button>`. Mirrors the Net
   *  Worth board. */
  function actionSlotFor(item: MapItem) {
    if (!onEditItem || !isWritable(item)) return null;
    return (
      <button
        type="button"
        aria-label={`Edit ${item.name}`}
        title={`Edit ${item.name}`}
        onClick={() => onEditItem(item)}
        className="text-ink-4 hover:text-accent"
      >
        <PencilIcon width={12} height={12} strokeWidth={1.5} />
      </button>
    );
  }

  function renderCard(c: MapItem) {
    return (
      <MapCard
        key={c.id}
        item={c}
        metaSlot={metaSlotFor(c)}
        valueSlot={valueSlotFor(c)}
        actionSlot={actionSlotFor(c)}
      />
    );
  }

  const COLUMNS: OwnerColumn[] = hasSpouse ? ["client", "joint", "spouse"] : ["client", "joint"];
  // `minmax(0,1fr)`, not a bare `1fr`. A bare `1fr` is `minmax(auto,1fr)`, so a
  // track never shrinks below its content's min-content width — one long income
  // name then steals width from the other columns and the card's own `truncate`
  // never engages, because there is nothing constraining it. Measured at 1800px:
  // a 60-character name pushed the three tracks to 592/293/295. This is what
  // Tailwind's own `grid-cols-3` expands to; only the arbitrary-value form here
  // had to opt in by hand.
  // 100px, not the original 74px: the gutter now carries the band's add button
  // alongside its label. "EXPENSES" at 10px/0.08em is ~53px, the button ~20px.
  const gridCols = hasSpouse
    ? "grid-cols-[100px_repeat(3,minmax(0,1fr))]"
    : "grid-cols-[100px_repeat(2,minmax(0,1fr))]";

  return (
    <div className="flex flex-col gap-4">
      {/* Step 1 — avatar header, shared by every band below. */}
      <div className={`grid ${gridCols} items-end gap-2`}>
        <div />
        {COLUMNS.map((col) => (
          <div key={col} className="flex flex-col items-center gap-1">
            {col === "joint" ? (
              <span className="text-sm font-semibold text-ink">Joint</span>
            ) : (
              <PersonNode person={col === "client" ? people.client : people.spouse!} />
            )}
          </div>
        ))}
      </div>

      {/* Step 1 — three bands, each crossed with the owner columns. */}
      {BANDS.map((band) => {
        const bandItems: MapItem[] = items.filter((i) =>
          (band.kinds as readonly string[]).includes(i.kind),
        );
        const trayItems = bandItems.filter((i) => i.column === "tray");
        const subtotal = bandItems.reduce((s, i) => s + i.value, 0);

        return (
          <div key={band.key} data-testid={`band-${band.key}`} className="flex flex-col gap-1.5">
            <div className={`grid ${gridCols} gap-2`}>
              {/* The band's add button lives HERE, beside the type label, and is
                  always present. The per-column placeholders below only render
                  in an EMPTY cell, so every band that already had a single row
                  in it offered no way to add a second one — the affordance
                  disappeared exactly when the advisor started using the board.
                  Column-less by nature (the gutter spans all three), so it
                  presets "joint"; the placeholders keep the per-column preset. */}
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-2">
                {band.label}
                {canEdit && (
                  <button
                    type="button"
                    aria-label={band.addLabel}
                    title={band.addLabel}
                    onClick={() => onAddFlow?.(band.key, "joint")}
                    className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border border-hair-2 bg-card-2 text-accent transition-colors hover:border-accent hover:bg-accent-wash"
                  >
                    <PlusIcon width={11} height={11} strokeWidth={2} />
                  </button>
                )}
              </div>
              {COLUMNS.map((col) => {
                const cards = bandItems.filter((i) => i.column === col);
                return (
                  <div
                    key={col}
                    data-testid={`band-${band.key}-column-${col}`}
                    className="flex flex-col gap-1.5"
                  >
                    {cards.map(renderCard)}
                    {/* Step 2 — empty cells are add targets. */}
                    {cards.length === 0 && canEdit && (
                      <button
                        type="button"
                        onClick={() => onAddFlow?.(band.key, col)}
                        className="min-h-7 rounded-md border border-dashed border-hair text-[10px] text-ink-4 hover:border-hair-2 hover:text-ink-3"
                      >
                        + add
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* AMENDED 2026-07-28 — tray row: entity-owned flows must not vanish. */}
            {trayItems.length > 0 && (
              <div
                data-testid={`band-${band.key}-tray`}
                className="flex flex-col gap-1.5 border-t border-dashed border-hair pt-1.5"
              >
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-2">
                  Held by trusts, businesses &amp; other family members
                </div>
                {/* Column-width cards, not full-bleed rows. A tray card is one
                    row's worth of information and stretching it the width of the
                    board read as more important than the owner columns above it.
                    Same three-up grid the Net Worth board's tray uses. */}
                <div className="grid grid-cols-3 gap-1.5">{trayItems.map(renderCard)}</div>
              </div>
            )}

            <div className="border-t border-hair pt-1 text-right text-[10px] text-ink-3">
              {band.label} · <b className="text-ink">{moneyLabel(subtotal)}</b>
            </div>
          </div>
        );
      })}
    </div>
  );
}
