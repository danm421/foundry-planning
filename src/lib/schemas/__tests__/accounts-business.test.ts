import { describe, it, expect } from "vitest";
import {
  AddBusinessInputSchema,
  BusinessOwnerRowSchema,
} from "../accounts-business";

// Valid v4 UUIDs (variant bits set: 8/9/a/b in position 19; version nibble = 4 in position 14).
const FM_ID = "11111111-1111-4111-8111-111111111111";
const FM_ID_2 = "22222222-2222-4222-8222-222222222222";
const ENT_ID = "33333333-3333-4333-8333-333333333333";

const validBase = {
  name: "Acme LLC",
  businessType: "llc" as const,
  value: 1_000_000,
  basis: 250_000,
  owners: [{ kind: "family_member", familyMemberId: FM_ID, percent: 1 }],
};

describe("AddBusinessInputSchema", () => {
  it("accepts a minimal valid input (defaults applied)", () => {
    const r = AddBusinessInputSchema.safeParse(validBase);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.flowMode).toBe("annual");
      expect(r.data.businessTaxTreatment).toBe("qbi");
    }
  });

  it("accepts a fully-populated input", () => {
    const r = AddBusinessInputSchema.safeParse({
      ...validBase,
      growthRate: 0.05,
      distributionPolicyPercent: 0.5,
      flowMode: "schedule",
      businessTaxTreatment: "ordinary",
      parentAccountId: ENT_ID,
      owners: [
        { kind: "family_member", familyMemberId: FM_ID, percent: 0.6 },
        { kind: "entity", entityId: ENT_ID, percent: 0.4 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("coerces numeric strings (matches form payload shape)", () => {
    const r = AddBusinessInputSchema.safeParse({
      ...validBase,
      value: "1000000",
      basis: "250000",
      owners: [{ kind: "family_member", familyMemberId: FM_ID, percent: "1" }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.value).toBe(1_000_000);
  });

  it("rejects owners that don't sum to 100%", () => {
    const r = AddBusinessInputSchema.safeParse({
      ...validBase,
      owners: [
        { kind: "family_member", familyMemberId: FM_ID, percent: 0.5 },
        { kind: "family_member", familyMemberId: FM_ID_2, percent: 0.4 },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msgs = r.error.issues.map((i) => i.message);
      expect(msgs).toContain("Ownership percentages must sum to 100%");
    }
  });

  it("rejects an empty owners array", () => {
    const r = AddBusinessInputSchema.safeParse({ ...validBase, owners: [] });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown businessType", () => {
    const r = AddBusinessInputSchema.safeParse({
      ...validBase,
      businessType: "co_op",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown flowMode", () => {
    const r = AddBusinessInputSchema.safeParse({
      ...validBase,
      flowMode: "biennial",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown businessTaxTreatment", () => {
    const r = AddBusinessInputSchema.safeParse({
      ...validBase,
      businessTaxTreatment: "amt",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a negative value or basis", () => {
    expect(
      AddBusinessInputSchema.safeParse({ ...validBase, value: -1 }).success,
    ).toBe(false);
    expect(
      AddBusinessInputSchema.safeParse({ ...validBase, basis: -1 }).success,
    ).toBe(false);
  });

  it("rejects distributionPolicyPercent outside [0,1]", () => {
    expect(
      AddBusinessInputSchema.safeParse({
        ...validBase,
        distributionPolicyPercent: 1.5,
      }).success,
    ).toBe(false);
    expect(
      AddBusinessInputSchema.safeParse({
        ...validBase,
        distributionPolicyPercent: -0.1,
      }).success,
    ).toBe(false);
  });

  it("accepts null/omitted growthRate, distributionPolicyPercent, parentAccountId", () => {
    expect(
      AddBusinessInputSchema.safeParse({
        ...validBase,
        growthRate: null,
        distributionPolicyPercent: null,
        parentAccountId: null,
      }).success,
    ).toBe(true);
    // Omitting them entirely is also OK
    expect(AddBusinessInputSchema.safeParse(validBase).success).toBe(true);
  });
});

describe("BusinessOwnerRowSchema", () => {
  it("accepts a family-member row", () => {
    const r = BusinessOwnerRowSchema.safeParse({
      kind: "family_member",
      familyMemberId: FM_ID,
      percent: 1,
    });
    expect(r.success).toBe(true);
  });

  it("accepts an entity row", () => {
    const r = BusinessOwnerRowSchema.safeParse({
      kind: "entity",
      entityId: ENT_ID,
      percent: 1,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a family-member row missing familyMemberId", () => {
    const r = BusinessOwnerRowSchema.safeParse({
      kind: "family_member",
      percent: 1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown kind", () => {
    const r = BusinessOwnerRowSchema.safeParse({
      kind: "external_beneficiary",
      percent: 1,
    });
    expect(r.success).toBe(false);
  });
});
