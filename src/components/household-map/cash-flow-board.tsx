import MapCard from "./map-card";
import PersonNode from "./person-node";
import { moneyLabel } from "@/lib/household-map/format";
import type { BoardCallbacks, HouseholdMapProps, MapColumn, MapItem } from "@/lib/household-map/types";

const BANDS = [
  { key: "income", label: "Income", kinds: ["income"] },
  { key: "savings", label: "Savings", kinds: ["savings"] },
  { key: "expense", label: "Expenses", kinds: ["expense"] },
] as const;

type OwnerColumn = Exclude<MapColumn, "tray">;

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
  isItemEditable,
}: HouseholdMapProps & BoardCallbacks) {
  const hasSpouse = people.spouse !== null;

  /** `undefined` renders a plain card instead of a button (see MapCard). A row
   *  the caller can't write — a synthesized life-insurance premium, say — must
   *  look inert, not merely behave inertly once clicked. */
  function clickHandlerFor(item: MapItem): (() => void) | undefined {
    if (!canEdit) return undefined;
    if (!(isItemEditable?.(item) ?? true)) return undefined;
    return () => onEditItem?.(item);
  }

  const COLUMNS: OwnerColumn[] = hasSpouse ? ["client", "joint", "spouse"] : ["client", "joint"];
  const gridCols = hasSpouse ? "grid-cols-[74px_repeat(3,1fr)]" : "grid-cols-[74px_repeat(2,1fr)]";

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
              <div className="flex items-center text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-2">
                {band.label}
              </div>
              {COLUMNS.map((col) => {
                const cards = bandItems.filter((i) => i.column === col);
                return (
                  <div
                    key={col}
                    data-testid={`band-${band.key}-column-${col}`}
                    className="flex flex-col gap-1.5"
                  >
                    {cards.map((c) => (
                      <MapCard key={c.id} item={c} onClick={clickHandlerFor(c)} />
                    ))}
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
                {trayItems.map((c) => (
                  <MapCard key={c.id} item={c} onClick={clickHandlerFor(c)} />
                ))}
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
