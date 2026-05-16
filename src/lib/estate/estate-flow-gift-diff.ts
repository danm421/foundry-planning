import { giftRecipientKindLabel, type EstateFlowGift } from "./estate-flow-gifts";

export interface GiftChange {
  /** Human-readable summary for the unsaved-changes list. */
  description: string;
  op: "add" | "update" | "remove";
  /** For add/update: the new gift state. For remove: the removed gift. */
  gift: EstateFlowGift;
}

/**
 * Structural equality over the plain-JSON EstateFlowGift shape.
 *
 * CONTRACT: `eq` uses `JSON.stringify`, which is both key-order- and
 * key-presence-sensitive. Any code that constructs an `EstateFlowGift` for
 * comparison (notably EstateFlowGiftFields' draft assembly) MUST either:
 *   a) spread an existing gift object — `{ ...gift, field: x }` — so that key
 *      order is preserved, or
 *   b) match the exact key order produced by `giftRowToDraft` /
 *      `giftSeriesRowToDraft` in `estate-flow-gifts.ts`.
 * Violating this contract produces spurious "update" diff entries even when
 * the values are identical. If that contract becomes hard to maintain, replace
 * this function with a field-by-field comparator.
 */
function eq(a: EstateFlowGift, b: EstateFlowGift): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function recipientWord(g: EstateFlowGift): string {
  return giftRecipientKindLabel(g.recipient.kind);
}

function describeChange(op: GiftChange["op"], g: EstateFlowGift): string {
  const verb = op === "add" ? "New gift" : op === "remove" ? "Removed gift" : "Edited gift";
  const detail =
    g.kind === "series"
      ? `recurring to ${recipientWord(g)} (${g.startYear}–${g.endYear})`
      : `to ${recipientWord(g)} (${g.year})`;
  return `${verb} — ${detail}`;
}

/**
 * Diff working gifts against the loaded originals, matched by id.
 * - id only in working → add
 * - id only in initial → remove
 * - id in both, content differs → update (carries the working state)
 * Output order: removes, then updates, then adds.
 */
export function diffGifts(
  initial: EstateFlowGift[],
  working: EstateFlowGift[],
): GiftChange[] {
  const initialById = new Map(initial.map((g) => [g.id, g]));
  const workingById = new Map(working.map((g) => [g.id, g]));

  const removes: GiftChange[] = [];
  const updates: GiftChange[] = [];
  const adds: GiftChange[] = [];

  for (const g of initial) {
    if (!workingById.has(g.id)) {
      removes.push({ op: "remove", gift: g, description: describeChange("remove", g) });
    }
  }
  for (const g of working) {
    const orig = initialById.get(g.id);
    if (!orig) {
      adds.push({ op: "add", gift: g, description: describeChange("add", g) });
    } else if (!eq(orig, g)) {
      updates.push({ op: "update", gift: g, description: describeChange("update", g) });
    }
  }

  return [...removes, ...updates, ...adds];
}
