import { describe, it, expect } from "vitest";
import { giftCreateSchema, giftUpdateSchema } from "../gifts";

const UUID = "11111111-1111-1111-1111-111111111111";

describe("giftCreateSchema", () => {
  it("accepts a minimal gift to a trust", () => {
    const r = giftCreateSchema.safeParse({
      year: 2026,
      amount: 2_400_000,
      grantor: "client",
      recipientEntityId: UUID,
      useCrummeyPowers: false,
    });
    expect(r.success).toBe(true);
  });

  it("rejects when more than one recipient is set", () => {
    const r = giftCreateSchema.safeParse({
      year: 2026,
      amount: 100,
      grantor: "client",
      recipientEntityId: UUID,
      recipientFamilyMemberId: UUID,
      useCrummeyPowers: false,
    });
    expect(r.success).toBe(false);
  });

  it("rejects when no recipient is set", () => {
    const r = giftCreateSchema.safeParse({
      year: 2026,
      amount: 100,
      grantor: "client",
      useCrummeyPowers: false,
    });
    expect(r.success).toBe(false);
  });

  it("rejects amount ≤ 0", () => {
    const r = giftCreateSchema.safeParse({
      year: 2026,
      amount: 0,
      grantor: "client",
      recipientEntityId: UUID,
      useCrummeyPowers: false,
    });
    expect(r.success).toBe(false);
  });

  it("rejects year out of plausible range", () => {
    const r = giftCreateSchema.safeParse({
      year: 1800,
      amount: 100,
      grantor: "client",
      recipientEntityId: UUID,
      useCrummeyPowers: false,
    });
    expect(r.success).toBe(false);
  });
});

describe("giftUpdateSchema", () => {
  it("accepts a partial update of amount only", () => {
    const r = giftUpdateSchema.safeParse({ amount: 50_000 });
    expect(r.success).toBe(true);
  });

  it("rejects a partial update setting two recipients at once", () => {
    const r = giftUpdateSchema.safeParse({
      recipientEntityId: UUID,
      recipientFamilyMemberId: UUID,
    });
    expect(r.success).toBe(false);
  });
});

describe("giftCreateSchema — Phase 3 discriminated union", () => {
  const ent = "11111111-1111-1111-1111-111111111111";
  const acct = "22222222-2222-2222-2222-222222222222";
  const liab = "33333333-3333-3333-3333-333333333333";

  it("accepts a cash gift (no account/liability)", () => {
    expect(
      giftCreateSchema.safeParse({
        year: 2026,
        amount: 19000,
        grantor: "client",
        recipientEntityId: ent,
        useCrummeyPowers: true,
      }).success,
    ).toBe(true);
  });

  it("accepts an asset transfer (account + percent, no amount)", () => {
    expect(
      giftCreateSchema.safeParse({
        year: 2030,
        grantor: "client",
        recipientEntityId: ent,
        accountId: acct,
        percent: 0.5,
      }).success,
    ).toBe(true);
  });

  it("accepts an asset transfer with amount override", () => {
    expect(
      giftCreateSchema.safeParse({
        year: 2030,
        amount: 400_000,
        grantor: "client",
        recipientEntityId: ent,
        accountId: acct,
        percent: 0.5,
      }).success,
    ).toBe(true);
  });

  it("accepts a liability transfer with parentGiftId", () => {
    expect(
      giftCreateSchema.safeParse({
        year: 2030,
        grantor: "client",
        recipientEntityId: ent,
        liabilityId: liab,
        percent: 0.5,
        parentGiftId: "44444444-4444-4444-4444-444444444444",
      }).success,
    ).toBe(true);
  });

  it("rejects accountId without percent", () => {
    expect(
      giftCreateSchema.safeParse({
        year: 2030,
        grantor: "client",
        recipientEntityId: ent,
        accountId: acct,
      }).success,
    ).toBe(false);
  });

  it("rejects both accountId and liabilityId set", () => {
    expect(
      giftCreateSchema.safeParse({
        year: 2030,
        grantor: "client",
        recipientEntityId: ent,
        accountId: acct,
        liabilityId: liab,
        percent: 0.5,
      }).success,
    ).toBe(false);
  });

  it("rejects cash gift without amount", () => {
    expect(
      giftCreateSchema.safeParse({
        year: 2026,
        grantor: "client",
        recipientEntityId: ent,
      }).success,
    ).toBe(false);
  });

  it("rejects percent on a cash gift (no account/liability)", () => {
    expect(
      giftCreateSchema.safeParse({
        year: 2026,
        amount: 19000,
        grantor: "client",
        recipientEntityId: ent,
        percent: 0.5,
      }).success,
    ).toBe(false);
  });
});

describe("giftSeriesSchema — Phase 3 extension", () => {
  const ent = "11111111-1111-1111-1111-111111111111";

  it("accepts a basic series", async () => {
    const { giftSeriesSchema } = await import("../gift-series");
    expect(
      giftSeriesSchema.safeParse({
        grantor: "client",
        recipientEntityId: ent,
        startYear: 2026,
        endYear: 2042,
        annualAmount: 19000,
        inflationAdjust: true,
        useCrummeyPowers: true,
      }).success,
    ).toBe(true);
  });

  it("rejects endYear < startYear", async () => {
    const { giftSeriesSchema } = await import("../gift-series");
    expect(
      giftSeriesSchema.safeParse({
        grantor: "client",
        recipientEntityId: ent,
        startYear: 2030,
        endYear: 2026,
        annualAmount: 19000,
      }).success,
    ).toBe(false);
  });
});

describe("QCD gifts (From an IRA)", () => {
  const ira = "44444444-4444-4444-4444-444444444444";
  const charity = "55555555-5555-5555-5555-555555555555";
  const base = {
    year: 2027,
    grantor: "client" as const,
    recipientExternalBeneficiaryId: charity,
    qcdAccountId: ira,
  };

  it("accepts a fixed QCD", () => {
    expect(
      giftCreateSchema.safeParse({ ...base, amount: 20_000, qcdAmountMode: "fixed" }).success,
    ).toBe(true);
  });

  it("accepts a full-RMD QCD with amount 0", () => {
    expect(
      giftCreateSchema.safeParse({ ...base, amount: 0, qcdAmountMode: "full_rmd" }).success,
    ).toBe(true);
  });

  it("rejects a full-RMD QCD with a non-zero amount", () => {
    expect(
      giftCreateSchema.safeParse({ ...base, amount: 5, qcdAmountMode: "full_rmd" }).success,
    ).toBe(false);
  });

  it("rejects a fixed QCD with amount 0", () => {
    expect(
      giftCreateSchema.safeParse({ ...base, amount: 0, qcdAmountMode: "fixed" }).success,
    ).toBe(false);
  });

  it("rejects a QCD with only one of the two fields", () => {
    const a = giftCreateSchema.safeParse({ ...base, amount: 20_000 });
    const b = giftCreateSchema.safeParse({
      year: 2027,
      grantor: "client",
      recipientExternalBeneficiaryId: charity,
      qcdAmountMode: "fixed",
      amount: 20_000,
    });
    expect(a.success).toBe(false);
    expect(b.success).toBe(false);
    if (!a.success) {
      expect(a.error.issues.map((i) => i.message)).toContain(
        "A QCD needs both the IRA and the amount mode",
      );
    }
  });

  it("rejects a QCD to a family member", () => {
    const r = giftCreateSchema.safeParse({
      year: 2027,
      grantor: "client",
      recipientFamilyMemberId: UUID,
      qcdAccountId: ira,
      qcdAmountMode: "fixed",
      amount: 20_000,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.message)).toContain("A QCD must go to a charity");
    }
  });

  it("rejects a QCD that also transfers an account", () => {
    const r = giftCreateSchema.safeParse({
      ...base,
      qcdAmountMode: "fixed",
      amount: 20_000,
      accountId: UUID,
      percent: 0.5,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.message)).toContain(
        "A QCD can't also transfer an account",
      );
    }
  });

  it("rejects a joint QCD", () => {
    const r = giftCreateSchema.safeParse({
      ...base,
      grantor: "joint",
      amount: 20_000,
      qcdAmountMode: "fixed",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.message)).toContain(
        "A QCD has one giver — the IRA's owner",
      );
    }
  });

  it("still rejects a non-QCD cash gift with amount 0", () => {
    expect(
      giftCreateSchema.safeParse({
        year: 2027,
        amount: 0,
        grantor: "client",
        recipientExternalBeneficiaryId: charity,
      }).success,
    ).toBe(false);
  });
});
