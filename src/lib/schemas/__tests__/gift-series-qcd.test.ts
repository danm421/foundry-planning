import { describe, it, expect } from "vitest";
import { giftSeriesSchema, giftSeriesUpdateSchema } from "../gift-series";

const IRA = "44444444-4444-4444-4444-444444444444";
const CHARITY = "55555555-5555-5555-5555-555555555555";
const FM = "11111111-1111-1111-1111-111111111111";

const base = {
  grantor: "client" as const,
  recipientExternalBeneficiaryId: CHARITY,
  startYear: 2027,
  endYear: 2035,
  qcdAccountId: IRA,
};

function messages(r: ReturnType<typeof giftSeriesSchema.safeParse>): string[] {
  return r.success ? [] : r.error.issues.map((i) => i.message);
}

describe("giftSeriesSchema — QCD", () => {
  it("accepts a fixed QCD series", () => {
    expect(
      giftSeriesSchema.safeParse({ ...base, annualAmount: 20_000, qcdAmountMode: "fixed" }).success,
    ).toBe(true);
  });

  it("accepts a full-RMD QCD series with annualAmount 0", () => {
    expect(
      giftSeriesSchema.safeParse({ ...base, annualAmount: 0, qcdAmountMode: "full_rmd" }).success,
    ).toBe(true);
  });

  it("rejects a full-RMD QCD series with a non-zero annualAmount", () => {
    expect(
      giftSeriesSchema.safeParse({ ...base, annualAmount: 5, qcdAmountMode: "full_rmd" }).success,
    ).toBe(false);
  });

  it("rejects a fixed QCD series with annualAmount 0", () => {
    expect(
      giftSeriesSchema.safeParse({ ...base, annualAmount: 0, qcdAmountMode: "fixed" }).success,
    ).toBe(false);
  });

  it("rejects a QCD with only one of the two fields", () => {
    const r = giftSeriesSchema.safeParse({ ...base, annualAmount: 20_000 });
    expect(messages(r)).toContain("A QCD needs both the IRA and the amount mode");
  });

  it("rejects a QCD to a family member", () => {
    const r = giftSeriesSchema.safeParse({
      grantor: "client",
      recipientFamilyMemberId: FM,
      startYear: 2027,
      endYear: 2035,
      annualAmount: 20_000,
      qcdAccountId: IRA,
      qcdAmountMode: "fixed",
    });
    expect(messages(r)).toContain("A QCD must go to a charity");
  });

  it("rejects a joint QCD", () => {
    const r = giftSeriesSchema.safeParse({
      ...base,
      grantor: "joint",
      annualAmount: 20_000,
      qcdAmountMode: "fixed",
    });
    expect(messages(r)).toContain("A QCD has one giver — the IRA's owner");
  });

  it("rejects a QCD on the annual-exclusion amount", () => {
    const r = giftSeriesSchema.safeParse({
      ...base,
      annualAmount: 20_000,
      qcdAmountMode: "fixed",
      amountMode: "annual_exclusion",
    });
    expect(messages(r)).toContain("A QCD can't use the annual-exclusion amount");
  });

  it("still rejects a non-QCD series with annualAmount 0", () => {
    expect(
      giftSeriesSchema.safeParse({
        grantor: "client",
        recipientExternalBeneficiaryId: CHARITY,
        startYear: 2027,
        endYear: 2030,
        annualAmount: 0,
      }).success,
    ).toBe(false);
  });
});

describe("giftSeriesUpdateSchema — QCD", () => {
  it("accepts clearing both QCD fields to null", () => {
    const r = giftSeriesUpdateSchema.safeParse({ qcdAccountId: null, qcdAmountMode: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ qcdAccountId: null, qcdAmountMode: null });
  });

  it("accepts changing only the amount mode", () => {
    expect(giftSeriesUpdateSchema.safeParse({ qcdAmountMode: "full_rmd", annualAmount: 0 }).success).toBe(true);
  });

  it("rejects half-cleared QCD fields", () => {
    expect(giftSeriesUpdateSchema.safeParse({ qcdAccountId: null, qcdAmountMode: "fixed" }).success).toBe(false);
  });

  it("rejects a QCD patch on the annual-exclusion amount", () => {
    const r = giftSeriesUpdateSchema.safeParse({
      qcdAccountId: IRA,
      qcdAmountMode: "fixed",
      amountMode: "annual_exclusion",
    });
    expect(r.success).toBe(false);
  });
});
