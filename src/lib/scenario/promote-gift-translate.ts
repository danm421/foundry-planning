// src/lib/scenario/promote-gift-translate.ts
//
// PURE. A `gift` scenario change carries an EstateFlowGift DRAFT, not a `gifts`
// row (lib/gifts/gift-write.ts). The draft names its recipient as a
// `{kind, id}` ref, its Crummey flag `crummey`, and an asset gift's manual
// valuation `amountOverride` — none of which are column names. `coerceForTable`
// copies only exact column-name matches, so promoting a gift dropped all three
// and left the three recipient FK columns NULL, which the DB then rejected on
// `gifts_recipient_exactly_one`: no scenario holding a gift could be promoted.
//
// The translation itself is the read side's own mapper (`giftDraftToRow`), so
// a promoted gift and the gift the scenario rendered can never disagree.
import { isEstateFlowGiftDraft } from "./apply-gift-overlays";
import { giftDraftToRow } from "@/lib/gifts/scenario-rows";

/**
 * Reshape a `gift` add payload into `gifts`-column shape ahead of coercion.
 *
 * Throws for a recurring series. `gift_series` is deliberately not a
 * TargetKind and the executor picks one table per kind, so a series draft has
 * nowhere to go: inserting it into `gifts` dies on the NOT NULL `year` column
 * with an opaque DB error, and skipping it would lose an advisor's gift in
 * silence.
 *
 * It is NOT reachable from the gift forms any more: `gift_series` is scenario-
 * partitioned, so every one of them writes a series straight to the series
 * route in both modes and none records it as a `gift` change. Two producers
 * remain, and both need the named failure rather than a Postgres one:
 *
 *  - the SOLVER's estate editor, whose gift dialog still offers Recurring and
 *    emits a `gift-upsert` mutation that becomes a `gift` change
 *    (mutations-to-scenario-changes.ts); a scenario saved that way cannot be
 *    promoted, and never could — before this message it died on the NOT NULL
 *    `year` column instead; and
 *  - legacy rows, from scenarios written before the gift forms stopped
 *    recording series as changes.
 */
export function translateGiftDraftForPromote(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  // Already in column shape (a change row predating the draft convention):
  // that is exactly what `coerceForTable` alone handles correctly, so leave it.
  if (!isEstateFlowGiftDraft(raw)) return raw;

  const row = giftDraftToRow(raw);
  if (row === null) {
    throw new Error(
      `promote: gift ${raw.id} is a recurring gift series, and promoting a ` +
        `series gift from a scenario change is not supported yet. Delete it ` +
        `from the scenario and re-create it on the base plan, then promote.`,
    );
  }

  // `notes` is OMITTED here, not passed through as null. DO NOT "restore" it.
  //
  // `EstateFlowGift` has no notes field, so `giftDraftToRow` emits `notes: null`
  // as a placeholder for the view. That was harmless while promotion only ever
  // INSERTed — null is the column default. But promotion now UPDATEs a base gift
  // in place when the change is an edit of it (`preserveId` in
  // promote-table-registry.ts), and a null in the SET would ERASE the advisor's
  // existing note on that row. `coerceForTable` skips keys the payload does not
  // carry (promote-coerce.ts:19-20), so dropping the key is correct on both
  // paths: INSERT still gets the NULL default, UPDATE leaves the note alone.
  //
  // `notes` is the only column with this problem. Every other value the mapper
  // emits is one the draft genuinely represents — clearing a discount, or
  // switching a gift from an asset to cash, SHOULD write null — and the columns
  // the draft cannot represent at all (`yearRef`, `liabilityId`,
  // `businessEntityId`, `parentGiftId`) are already absent from its output.
  const { notes: _notes, ...forPromote } = row;
  void _notes;
  return forPromote;
}
