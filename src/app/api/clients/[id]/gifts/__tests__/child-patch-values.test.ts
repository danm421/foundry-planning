import { describe, it, expect } from "vitest";
import { buildChildPatchValues } from "../child-values";

describe("buildChildPatchValues", () => {
  it("propagates percent alone when only percent changed", () => {
    const out = buildChildPatchValues({ percent: 0.25 });
    expect(out).toEqual({ percent: "0.25" });
  });

  it("propagates an entity→family_member recipient change, clearing the entity", () => {
    const out = buildChildPatchValues({
      recipientEntityId: null,
      recipientFamilyMemberId: "fm-child",
    });
    expect(out).toEqual({
      recipientEntityId: null,
      recipientFamilyMemberId: "fm-child",
    });
  });

  it("clears the previous recipient when a new kind is named", () => {
    // The parent moved from a family member to a charity. Both keys must be
    // written, or the child keeps two recipients and violates the CHECK.
    const out = buildChildPatchValues({
      recipientFamilyMemberId: null,
      recipientExternalBeneficiaryId: "ext-charity",
    });
    expect(out).toEqual({
      recipientFamilyMemberId: null,
      recipientExternalBeneficiaryId: "ext-charity",
    });
  });

  it("returns null when the patch touches nothing a child mirrors", () => {
    expect(buildChildPatchValues({ notes: "hello" })).toBeNull();
    expect(buildChildPatchValues({})).toBeNull();
  });

  it("does not propagate amount or valuationDiscount to a child", () => {
    const out = buildChildPatchValues({ amount: 500, valuationDiscount: 0.3 });
    expect(out).toBeNull();
  });
});
