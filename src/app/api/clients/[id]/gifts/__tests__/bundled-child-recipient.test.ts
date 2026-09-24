import { describe, it, expect } from "vitest";
import { buildBundledChildValues } from "../child-values";

describe("buildBundledChildValues", () => {
  const base = {
    clientId: "client-1",
    year: 2030,
    yearRef: null,
    grantor: "client" as const,
    accountId: "acct-1",
    linkedLiabilityId: "liab-1",
    percent: 0.15,
    parentGiftId: "gift-1",
  };

  it("carries a family-member recipient onto the child", () => {
    const row = buildBundledChildValues({
      ...base,
      recipientEntityId: null,
      recipientFamilyMemberId: "fm-child",
      recipientExternalBeneficiaryId: null,
    });
    expect(row.recipientFamilyMemberId).toBe("fm-child");
    expect(row.recipientEntityId).toBeNull();
    expect(row.recipientExternalBeneficiaryId).toBeNull();
  });

  it("carries an external-beneficiary recipient onto the child", () => {
    const row = buildBundledChildValues({
      ...base,
      recipientEntityId: null,
      recipientFamilyMemberId: null,
      recipientExternalBeneficiaryId: "ext-charity",
    });
    expect(row.recipientExternalBeneficiaryId).toBe("ext-charity");
    expect(row.recipientEntityId).toBeNull();
    expect(row.recipientFamilyMemberId).toBeNull();
  });

  it("still carries an entity recipient (the case that already worked)", () => {
    const row = buildBundledChildValues({
      ...base,
      recipientEntityId: "trust-1",
      recipientFamilyMemberId: null,
      recipientExternalBeneficiaryId: null,
    });
    expect(row.recipientEntityId).toBe("trust-1");
  });

  it("sets exactly one recipient for every recipient kind", () => {
    const kinds = [
      { recipientEntityId: "trust-1", recipientFamilyMemberId: null, recipientExternalBeneficiaryId: null },
      { recipientEntityId: null, recipientFamilyMemberId: "fm-child", recipientExternalBeneficiaryId: null },
      { recipientEntityId: null, recipientFamilyMemberId: null, recipientExternalBeneficiaryId: "ext-charity" },
    ];
    for (const k of kinds) {
      const row = buildBundledChildValues({ ...base, ...k });
      const set = [
        row.recipientEntityId,
        row.recipientFamilyMemberId,
        row.recipientExternalBeneficiaryId,
      ].filter((v) => v != null);
      expect(set).toHaveLength(1);
    }
  });

  it("omits valuationDiscount — a liability transfer contributes $0 to the ledger", () => {
    const row = buildBundledChildValues({
      ...base,
      recipientEntityId: null,
      recipientFamilyMemberId: "fm-child",
      recipientExternalBeneficiaryId: null,
    });
    expect("valuationDiscount" in row).toBe(false);
  });
});
