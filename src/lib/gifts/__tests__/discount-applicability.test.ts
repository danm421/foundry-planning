import { describe, it, expect } from "vitest";
import {
  discountAppliesToShape,
  discountAppliesToDraft,
} from "@/lib/gifts/discount-applicability";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";

// The rule GiftForm uses to decide whether to RENDER the discount field, and
// the Family view's GiftDialog uses to decide whether an empty draft discount
// means "cleared" or "never asked". They must never disagree — a mismatch
// silently clears or silently keeps a figure that may be on a filed Form 709.

describe("discountAppliesToShape", () => {
  const shape = (over: Partial<Parameters<typeof discountAppliesToShape>[0]>) =>
    discountAppliesToShape({
      recurring: false,
      inKind: false,
      recipientIsIrrevocableTrust: false,
      ...over,
    });

  it("offers the field for a recurring series", () => {
    expect(shape({ recurring: true })).toBe(true);
  });

  it("offers the field for an in-kind transfer", () => {
    expect(shape({ inKind: true })).toBe(true);
  });

  it("offers the field for cash into an irrevocable trust", () => {
    expect(shape({ recipientIsIrrevocableTrust: true })).toBe(true);
  });

  it("offers nothing on a one-time cash gift to an individual", () => {
    // The approved product decision: nothing to appraise, so no field.
    expect(shape({})).toBe(false);
  });
});

describe("discountAppliesToDraft", () => {
  const trusts = new Set(["t1"]);
  const recipientTrust = { kind: "entity", id: "t1" } as const;
  const recipientPerson = { kind: "family_member", id: "m1" } as const;

  it("is true for every series (recurring)", () => {
    const d = { kind: "series", recipient: recipientPerson } as unknown as EstateFlowGift;
    expect(discountAppliesToDraft(d, trusts)).toBe(true);
  });

  it("is true for every asset gift (in-kind)", () => {
    const d = { kind: "asset-once", recipient: recipientPerson } as unknown as EstateFlowGift;
    expect(discountAppliesToDraft(d, trusts)).toBe(true);
  });

  it("is true for cash to an irrevocable trust", () => {
    const d = { kind: "cash-once", recipient: recipientTrust } as unknown as EstateFlowGift;
    expect(discountAppliesToDraft(d, trusts)).toBe(true);
  });

  it("is false for cash to an individual", () => {
    const d = { kind: "cash-once", recipient: recipientPerson } as unknown as EstateFlowGift;
    expect(discountAppliesToDraft(d, trusts)).toBe(false);
  });

  it("is false for cash to an entity that is not an irrevocable trust", () => {
    const d = {
      kind: "cash-once",
      recipient: { kind: "entity", id: "llc9" },
    } as unknown as EstateFlowGift;
    expect(discountAppliesToDraft(d, trusts)).toBe(false);
  });
});
