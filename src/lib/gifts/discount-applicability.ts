import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";

/**
 * Which gift shapes can carry a valuation discount: an in-kind transfer, a
 * recurring series, or cash into an irrevocable trust — the three shapes where
 * an appraised fractional interest is plausible. Cash handed to an individual
 * has nothing to appraise, so it is offered no field.
 *
 * Two advisor surfaces need the same answer and must never disagree. `GiftForm`
 * decides whether to RENDER the field; the Family view's `GiftDialog` decides at
 * SAVE time whether an empty draft discount means "the advisor cleared it"
 * (send null) or "the field was never on screen" (omit the key and leave the
 * saved row alone). A disagreement silently clears — or silently keeps — a
 * figure that may already be on a filed Form 709. That is why the rule lives
 * here rather than in either caller, the same reason `select-prior-discounts`
 * does.
 *
 * Callers differ only in the language they can express a gift in: the form holds
 * live toggle state and has no draft yet, the dialog holds an assembled draft.
 */
export function discountAppliesToShape(shape: {
  recurring: boolean;
  inKind: boolean;
  recipientIsIrrevocableTrust: boolean;
}): boolean {
  return shape.recurring || shape.inKind || shape.recipientIsIrrevocableTrust;
}

/** The same rule read off an assembled draft, for callers that only have one. */
export function discountAppliesToDraft(
  draft: EstateFlowGift,
  irrevocableTrustIds: ReadonlySet<string>,
): boolean {
  return discountAppliesToShape({
    recurring: draft.kind === "series",
    inKind: draft.kind === "asset-once",
    recipientIsIrrevocableTrust:
      draft.recipient.kind === "entity" && irrevocableTrustIds.has(draft.recipient.id),
  });
}
