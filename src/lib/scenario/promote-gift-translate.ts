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
 * silence. Series gifts DO reach here — transfer-series-form.tsx writes one as
 * a `gift` change — so this is a live path, not a defensive branch.
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
  return row;
}
