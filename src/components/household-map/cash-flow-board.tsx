"use client";

import type { ReactNode } from "react";
import MapCard from "./map-card";
import PersonNode from "./person-node";
import { PencilIcon, PlusIcon } from "@/components/icons";
import { InlineAmount } from "@/components/forms/inline-amount";
// A style constant, not a component — `portalBtn` is a plain string map with no
// hooks and no server-only imports, so importing it here costs the advisor
// bundle nothing. It is the treatment the portal's other add buttons already
// wear; spelling it out again here is how the five existing copies of it in the
// app drifted apart.
import { portalBtn } from "@/components/portal/portal-card";
import { moneyLabel } from "@/lib/household-map/format";
import { coerceYearRef, YEAR_REF_LABELS } from "@/lib/milestones";
import type {
  BoardCallbacks,
  CashFlowBoardProps,
  FlowTiming,
  MapColumn,
  MapItem,
} from "@/lib/household-map/types";

// `addLabel` is written out rather than derived from `label`, because the two
// don't line up: the Expenses band is plural and its button adds one expense.
//
// `hue` is the band's rule in the portal panel header, drawn from the app's
// category palette so the three sections are told apart at a glance. It reads
// by MEANING, not by matching the cards underneath — savings flow into the
// portfolio, expenses are transactions — so do NOT expect a band's rule to
// equal its cards' left border (`MapCard`'s `CATEGORY_BORDER` colours those by
// each row's own category, and every savings row is category "investments").
// Deliberately not `--color-crit` for Expenses: that is the app's error red,
// and an ordinary grocery band wearing it reads as an alert.
const BANDS = [
  { key: "income", label: "Income", addLabel: "Add income", kinds: ["income"], hue: "bg-[color:var(--color-cat-income)]" },
  { key: "savings", label: "Savings", addLabel: "Add savings", kinds: ["savings"], hue: "bg-[color:var(--color-cat-portfolio)]" },
  { key: "expense", label: "Expenses", addLabel: "Add expense", kinds: ["expense"], hue: "bg-[color:var(--color-cat-transactions)]" },
] as const;

type Band = (typeof BANDS)[number];
type OwnerColumn = Exclude<MapColumn, "tray">;

/**
 * Which chrome the bands wear. The advisor Household Map is a dense workspace of
 * boards; the client portal shows this one board, alone, to a non-advisor. So
 * the portal gets section chrome the advisor does not — see `PortalBand`.
 *
 * NOT purely cosmetic: `showEmptyCellAdd` in `CashFlowBoard` turns off a real
 * affordance for the portal too. Read this as "which surface is this", not "how
 * does it look".
 */
export type BoardVariant = "advisor" | "portal";

/** Everything a band's chrome needs. The owner-column cells and the tray row are
 *  built once in `CashFlowBoard` and handed down, because they are identical in
 *  both variants — only what surrounds them differs. */
interface BandChromeProps {
  band: Band;
  hasSpouse: boolean;
  canEdit: boolean;
  onAddFlow: BoardCallbacks["onAddFlow"];
  subtotal: number;
  tray: ReactNode;
  /** The per-owner column cells, dropped straight into the band's own grid. */
  children: ReactNode;
}

/**
 * The advisor Household Map's band: a label gutter, the owner columns, the tray,
 * and a hairline subtotal. Unchanged since before the portal variant existed —
 * keeping it a separate component is what guarantees that, because no portal
 * tweak can reach these lines.
 *
 * The add button is always present. The per-column placeholders `CashFlowBoard`
 * renders only appear in an EMPTY cell, so every band that already had a single
 * row in it offered no way to add a second one — the affordance disappeared
 * exactly when the advisor started using the board. Column-less by nature (the
 * gutter spans all three), so it presets "joint"; the placeholders keep the
 * per-column preset.
 */
function AdvisorBand({
  band,
  hasSpouse,
  canEdit,
  onAddFlow,
  subtotal,
  tray,
  children,
}: BandChromeProps) {
  // 100px, not the original 74px: the gutter carries the band's add button
  // alongside its label. "EXPENSES" at 10px/0.08em is ~53px, the button ~20px.
  const gridCols = hasSpouse
    ? "grid-cols-[100px_repeat(3,minmax(0,1fr))]"
    : "grid-cols-[100px_repeat(2,minmax(0,1fr))]";

  return (
    <div data-testid={`band-${band.key}`} className="flex flex-col gap-1.5">
      <div className={`grid ${gridCols} gap-2`}>
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
        {children}
      </div>
      {tray}
      <div className="border-t border-hair pt-1 text-right text-[10px] text-ink-3">
        {band.label} · <b className="text-ink">{moneyLabel(subtotal)}</b>
      </div>
    </div>
  );
}

/**
 * The client portal's band: a bordered panel, so Income / Savings / Expenses
 * read as three defined categories rather than three rows of one spreadsheet.
 * Header carries the category rule, the name, and a full-size labelled add
 * button; the subtotal closes the panel as a footer.
 *
 * No label gutter — the label moved into the header, and a labelled "Add income"
 * never fitted in 100px anyway. The portal client's `min-w` is computed from the
 * track count, so that omission is load-bearing arithmetic over there.
 */
function PortalBand({
  band,
  hasSpouse,
  canEdit,
  onAddFlow,
  subtotal,
  tray,
  children,
}: BandChromeProps) {
  const gridCols = hasSpouse
    ? "grid-cols-[repeat(3,minmax(0,1fr))]"
    : "grid-cols-[repeat(2,minmax(0,1fr))]";

  return (
    <div
      data-testid={`band-${band.key}`}
      className="flex flex-col overflow-hidden rounded-xl border border-hair-2 bg-card"
    >
      <div className="flex items-center justify-between gap-3 border-b border-hair bg-card-2 px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden className={`h-4 w-[3px] shrink-0 rounded-full ${band.hue}`} />
          <span className="truncate text-[13px] font-semibold text-ink">{band.label}</span>
        </span>
        {canEdit && (
          <button
            type="button"
            aria-label={band.addLabel}
            title={band.addLabel}
            onClick={() => onAddFlow?.(band.key, "joint")}
            className={`${portalBtn.accent} shrink-0`}
          >
            <PlusIcon width={14} height={14} strokeWidth={2} />
            {band.addLabel}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1.5 px-3 py-3">
        <div className={`grid ${gridCols} gap-2`}>{children}</div>
        {tray}
      </div>
      <div className="border-t border-hair bg-card-2 px-3 py-2 text-right text-[11px] text-ink-3">
        {band.label} · <b className="tabular text-ink">{moneyLabel(subtotal)}</b>
      </div>
    </div>
  );
}

/**
 * "2026-2060", or a single year when the window is one year wide — unless the row
 * carries a `startsAt` note, which REPLACES the range outright ("at 70").
 *
 * Only Social Security sets one, and only while the benefit is unclaimed: its
 * persisted years are inert, so the range named a window the projection does not
 * use. `ssStartNote` in `@/lib/household-map/social-security` owns that rule.
 */
function timingLabel(t: FlowTiming): string {
  if (t.startsAt) return t.startsAt.label;
  return t.startYear === t.endYear ? String(t.startYear) : `${t.startYear}-${t.endYear}`;
}

/**
 * Tooltip for the timing cell. Names the milestone anchor when the row has one,
 * because "2035" and "the year Cooper retires" are the same number until
 * retirement age moves — and only one of them follows it. `coerceYearRef` narrows
 * the persisted string; an unrecognised token degrades to the bare year rather
 * than indexing `YEAR_REF_LABELS` with undefined.
 *
 * A row with a `startsAt` note uses that note's own sentence, NOT the note plus
 * the years: the years are the inert columns the note exists to replace, and
 * repeating them in the tooltip would put the wrong number back in front of the
 * advisor one hover later.
 */
function timingTitle(t: FlowTiming): string {
  if (t.startsAt) return t.startsAt.title;
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
  variant = "advisor",
}: CashFlowBoardProps & BoardCallbacks & { variant?: BoardVariant }) {
  const hasSpouse = people.spouse !== null;
  const isPortal = variant === "portal";
  const BandChrome = isPortal ? PortalBand : AdvisorBand;

  /**
   * The dashed placeholder in an empty owner cell. Advisor only, and that is a
   * real affordance difference rather than styling: the placeholder exists to
   * preset ITS column, and the portal's add panel has no column preset to seed
   * (an income's Owner select defaults to the client). On that surface it is a
   * second control doing exactly what the panel-header button already does —
   * and a dashed strip through an otherwise defined section reads as a gap in
   * the panel.
   */
  const showEmptyCellAdd = !isPortal;

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
        // The name opens the same editor the pencil does — same gate, so a row
        // that must look inert stays inert.
        onNameClick={onEditItem && isWritable(c) ? () => onEditItem(c) : undefined}
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
  // The avatar header alone — each band owns its own copy, because the portal
  // has no label gutter to leave room for. Written out in full, never
  // interpolated: Tailwind extracts classes by scanning source text, so a
  // template-literal class name generates no CSS.
  const headerCols = isPortal
    ? hasSpouse
      ? "grid-cols-[repeat(3,minmax(0,1fr))]"
      : "grid-cols-[repeat(2,minmax(0,1fr))]"
    : hasSpouse
      ? "grid-cols-[100px_repeat(3,minmax(0,1fr))]"
      : "grid-cols-[100px_repeat(2,minmax(0,1fr))]";

  return (
    <div className="flex flex-col gap-4">
      {/* Step 1 — avatar header, shared by every band below. */}
      <div className={`grid ${headerCols} items-end gap-2`}>
        {!isPortal && <div />}
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

        // AMENDED 2026-07-28 — tray row: entity-owned flows must not vanish.
        const tray =
          trayItems.length > 0 ? (
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
          ) : null;

        return (
          <BandChrome
            key={band.key}
            band={band}
            hasSpouse={hasSpouse}
            canEdit={canEdit}
            onAddFlow={onAddFlow}
            subtotal={subtotal}
            tray={tray}
          >
            {COLUMNS.map((col) => {
              const cards = bandItems.filter((i) => i.column === col);
              return (
                <div
                  key={col}
                  data-testid={`band-${band.key}-column-${col}`}
                  className="flex flex-col gap-1.5"
                >
                  {cards.map(renderCard)}
                  {/* Step 2 — empty cells are add targets. See `showEmptyCellAdd`. */}
                  {cards.length === 0 && canEdit && showEmptyCellAdd && (
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
          </BandChrome>
        );
      })}
    </div>
  );
}
