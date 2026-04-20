import { describe, it, expect } from "vitest";
import {
  computeGiftTaxTreatment,
  type GiftInput,
  type GiftContext,
} from "../compute-tax-treatment";

const giftTo = (partial: Partial<GiftInput>): GiftInput => ({
  amount: 100,
  useCrummeyPowers: false,
  recipientEntityId: null,
  recipientFamilyMemberId: null,
  recipientExternalBeneficiaryId: null,
  ...partial,
});

describe("computeGiftTaxTreatment", () => {
  it("irrevocable trust, Crummey off → full lifetime", () => {
    const r = computeGiftTaxTreatment(
      giftTo({ amount: 2_400_000, recipientEntityId: "t1" }),
      {
        entity: { isIrrevocable: true, entityType: "trust" },
        annualExclusionAmount: 19_000,
        crummeyBeneficiaryCount: 0,
      },
    );
    expect(r).toEqual({ lifetimeUsed: 2_400_000, annualExcluded: 0, charitableExcluded: 0 });
  });

  it("irrevocable trust, Crummey on, 3 beneficiaries, gift within exclusion → fully excluded", () => {
    const r = computeGiftTaxTreatment(
      giftTo({ amount: 50_000, useCrummeyPowers: true, recipientEntityId: "t1" }),
      {
        entity: { isIrrevocable: true, entityType: "trust" },
        annualExclusionAmount: 19_000,
        crummeyBeneficiaryCount: 3,
      },
    );
    expect(r).toEqual({ lifetimeUsed: 0, annualExcluded: 50_000, charitableExcluded: 0 });
  });

  it("irrevocable trust, Crummey on, 3 beneficiaries, gift over 3 × exclusion → remainder to lifetime", () => {
    const r = computeGiftTaxTreatment(
      giftTo({ amount: 100_000, useCrummeyPowers: true, recipientEntityId: "t1" }),
      {
        entity: { isIrrevocable: true, entityType: "trust" },
        annualExclusionAmount: 19_000,
        crummeyBeneficiaryCount: 3,
      },
    );
    expect(r).toEqual({ lifetimeUsed: 43_000, annualExcluded: 57_000, charitableExcluded: 0 });
  });

  it("family member, within single exclusion → fully annual-excluded", () => {
    const r = computeGiftTaxTreatment(
      giftTo({ amount: 10_000, recipientFamilyMemberId: "fm1" }),
      { annualExclusionAmount: 19_000, crummeyBeneficiaryCount: 0 },
    );
    expect(r).toEqual({ lifetimeUsed: 0, annualExcluded: 10_000, charitableExcluded: 0 });
  });

  it("family member, over exclusion → remainder lifetime", () => {
    const r = computeGiftTaxTreatment(
      giftTo({ amount: 25_000, recipientFamilyMemberId: "fm1" }),
      { annualExclusionAmount: 19_000, crummeyBeneficiaryCount: 0 },
    );
    expect(r).toEqual({ lifetimeUsed: 6_000, annualExcluded: 19_000, charitableExcluded: 0 });
  });

  it("external individual → same rule as family member", () => {
    const r = computeGiftTaxTreatment(
      giftTo({ amount: 25_000, recipientExternalBeneficiaryId: "ext1" }),
      {
        external: { kind: "individual" },
        annualExclusionAmount: 19_000,
        crummeyBeneficiaryCount: 0,
      },
    );
    expect(r).toEqual({ lifetimeUsed: 6_000, annualExcluded: 19_000, charitableExcluded: 0 });
  });

  it("external charity → all charitable-excluded", () => {
    const r = computeGiftTaxTreatment(
      giftTo({ amount: 1_000_000, recipientExternalBeneficiaryId: "ext1" }),
      {
        external: { kind: "charity" },
        annualExclusionAmount: 19_000,
        crummeyBeneficiaryCount: 0,
      },
    );
    expect(r).toEqual({ lifetimeUsed: 0, annualExcluded: 0, charitableExcluded: 1_000_000 });
  });

  it("revocable trust → throws", () => {
    expect(() =>
      computeGiftTaxTreatment(
        giftTo({ amount: 100_000, recipientEntityId: "t1" }),
        {
          entity: { isIrrevocable: false, entityType: "trust" },
          annualExclusionAmount: 19_000,
          crummeyBeneficiaryCount: 0,
        },
      ),
    ).toThrow(/revocable/i);
  });

  it("non-trust entity → throws", () => {
    expect(() =>
      computeGiftTaxTreatment(
        giftTo({ amount: 100_000, recipientEntityId: "e1" }),
        {
          entity: { isIrrevocable: true, entityType: "llc" },
          annualExclusionAmount: 19_000,
          crummeyBeneficiaryCount: 0,
        },
      ),
    ).toThrow(/trust/i);
  });

  it("irrevocable trust, Crummey on, 0 beneficiaries → all lifetime", () => {
    const r = computeGiftTaxTreatment(
      giftTo({ amount: 50_000, useCrummeyPowers: true, recipientEntityId: "t1" }),
      {
        entity: { isIrrevocable: true, entityType: "trust" },
        annualExclusionAmount: 19_000,
        crummeyBeneficiaryCount: 0,
      },
    );
    expect(r).toEqual({ lifetimeUsed: 50_000, annualExcluded: 0, charitableExcluded: 0 });
  });
});
