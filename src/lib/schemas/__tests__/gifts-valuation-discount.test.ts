import { describe, it, expect } from "vitest";
import { giftCreateSchema, giftUpdateSchema } from "../gifts";
import { giftSeriesSchema, giftSeriesUpdateSchema } from "../gift-series";

const TRUST = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "22222222-2222-4222-8222-222222222222";

const assetGift = (over: Record<string, unknown> = {}) => ({
  year: 2030,
  grantor: "client" as const,
  recipientEntityId: TRUST,
  accountId: ACCOUNT,
  percent: 0.25,
  ...over,
});

const series = (over: Record<string, unknown> = {}) => ({
  grantor: "client" as const,
  recipientEntityId: TRUST,
  startYear: 2030,
  endYear: 2035,
  annualAmount: 50_000,
  ...over,
});

describe("giftCreateSchema — valuationDiscount", () => {
  it("accepts a 30% discount as the fraction 0.3", () => {
    const r = giftCreateSchema.safeParse(assetGift({ valuationDiscount: 0.3 }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.valuationDiscount).toBe(0.3);
  });

  it("accepts an explicit 0", () => {
    expect(giftCreateSchema.safeParse(assetGift({ valuationDiscount: 0 })).success).toBe(true);
  });

  it("accepts null", () => {
    expect(giftCreateSchema.safeParse(assetGift({ valuationDiscount: null })).success).toBe(true);
  });

  it("accepts an omitted field", () => {
    expect(giftCreateSchema.safeParse(assetGift()).success).toBe(true);
  });

  it("rejects a discount of exactly 1", () => {
    expect(giftCreateSchema.safeParse(assetGift({ valuationDiscount: 1 })).success).toBe(false);
  });

  it("rejects a discount above 1", () => {
    expect(giftCreateSchema.safeParse(assetGift({ valuationDiscount: 1.5 })).success).toBe(false);
  });

  it("rejects a negative discount", () => {
    expect(giftCreateSchema.safeParse(assetGift({ valuationDiscount: -0.1 })).success).toBe(false);
  });
});

describe("giftUpdateSchema — valuationDiscount", () => {
  it("accepts a discount on its own", () => {
    const r = giftUpdateSchema.safeParse({ valuationDiscount: 0.35 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.valuationDiscount).toBe(0.35);
  });

  it("accepts null to clear the discount", () => {
    const r = giftUpdateSchema.safeParse({ valuationDiscount: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.valuationDiscount).toBeNull();
  });

  it("rejects 1 and 1.5 and -0.1", () => {
    expect(giftUpdateSchema.safeParse({ valuationDiscount: 1 }).success).toBe(false);
    expect(giftUpdateSchema.safeParse({ valuationDiscount: 1.5 }).success).toBe(false);
    expect(giftUpdateSchema.safeParse({ valuationDiscount: -0.1 }).success).toBe(false);
  });

  it("does NOT inject a valuationDiscount key on an empty patch (strictPartial contract)", () => {
    const r = giftUpdateSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect("valuationDiscount" in r.data).toBe(false);
  });
});

describe("giftSeriesSchema — valuationDiscount", () => {
  it("accepts a fraction and rejects out-of-range values", () => {
    expect(giftSeriesSchema.safeParse(series({ valuationDiscount: 0.3 })).success).toBe(true);
    expect(giftSeriesSchema.safeParse(series({ valuationDiscount: null })).success).toBe(true);
    expect(giftSeriesSchema.safeParse(series()).success).toBe(true);
    expect(giftSeriesSchema.safeParse(series({ valuationDiscount: 1 })).success).toBe(false);
    expect(giftSeriesSchema.safeParse(series({ valuationDiscount: -0.1 })).success).toBe(false);
  });
});

describe("giftSeriesUpdateSchema — valuationDiscount", () => {
  it("accepts a fraction and null, rejects out-of-range values", () => {
    expect(giftSeriesUpdateSchema.safeParse({ valuationDiscount: 0.3 }).success).toBe(true);
    expect(giftSeriesUpdateSchema.safeParse({ valuationDiscount: null }).success).toBe(true);
    expect(giftSeriesUpdateSchema.safeParse({ valuationDiscount: 1 }).success).toBe(false);
    expect(giftSeriesUpdateSchema.safeParse({ valuationDiscount: 2 }).success).toBe(false);
  });
});
