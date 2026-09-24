import { describe, it, expect } from "vitest";
import { buildRecipientPatchFields } from "../recipient-patch-fields";

describe("buildRecipientPatchFields", () => {
  it("builds a PATCH body for an entity recipient", () => {
    const out = buildRecipientPatchFields({ kind: "entity", id: "ent-trust-1" });
    expect(out).toEqual({
      recipientEntityId: "ent-trust-1",
      recipientFamilyMemberId: null,
      recipientExternalBeneficiaryId: null,
    });
  });

  it("builds a PATCH body for a family_member recipient", () => {
    const out = buildRecipientPatchFields({ kind: "family_member", id: "fm-child" });
    expect(out).toEqual({
      recipientEntityId: null,
      recipientFamilyMemberId: "fm-child",
      recipientExternalBeneficiaryId: null,
    });
  });

  it("builds a PATCH body for an external_beneficiary recipient", () => {
    const out = buildRecipientPatchFields({ kind: "external_beneficiary", id: "ext-charity" });
    expect(out).toEqual({
      recipientEntityId: null,
      recipientFamilyMemberId: null,
      recipientExternalBeneficiaryId: "ext-charity",
    });
  });

  it("includes exactly one non-null recipient and two explicit nulls", () => {
    const testCases = [
      { kind: "entity" as const, id: "ent-1" },
      { kind: "family_member" as const, id: "fm-1" },
      { kind: "external_beneficiary" as const, id: "ext-1" },
    ];
    testCases.forEach((rc) => {
      const out = buildRecipientPatchFields(rc);
      const nonNullCount = Object.values(out).filter((v) => v != null).length;
      expect(nonNullCount).toBe(1);
    });
  });
});
