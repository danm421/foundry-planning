import { describe, it, expect, beforeEach, vi } from "vitest";
import type Stripe from "stripe";

const h = vi.hoisted(() => ({
  couponCreate: vi.fn(),
  couponDel: vi.fn(),
  promoCreate: vi.fn(),
  promoList: vi.fn(),
  promoUpdate: vi.fn(),
}));

vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({
    coupons: {
      create: (...a: unknown[]) => h.couponCreate(...a),
      del: (...a: unknown[]) => h.couponDel(...a),
    },
    promotionCodes: {
      create: (...a: unknown[]) => h.promoCreate(...a),
      list: (...a: unknown[]) => h.promoList(...a),
      update: (...a: unknown[]) => h.promoUpdate(...a),
    },
  }),
}));

import {
  buildCouponParams,
  buildPromotionCodeParams,
  normalizePromoCode,
  toPromoCodeRow,
  createPromoCode,
  listPromoCodes,
  deactivatePromoCode,
} from "../promo-codes";

beforeEach(() => {
  h.couponCreate.mockReset().mockResolvedValue({ id: "coupon_1" });
  h.couponDel.mockReset().mockResolvedValue({ id: "coupon_1", deleted: true });
  h.promoCreate.mockReset().mockResolvedValue({ id: "promo_1", code: "FOUNDER25" });
  h.promoList.mockReset().mockResolvedValue({ data: [], has_more: false });
  h.promoUpdate.mockReset().mockResolvedValue({ id: "promo_1", active: false });
});

// Fixtures match the real Stripe object shapes, so a field the SDK renames or
// re-types fails the typecheck here rather than only in production.
function stripeCoupon(over: Partial<Stripe.Coupon> = {}): Stripe.Coupon {
  return {
    id: "coupon_1",
    object: "coupon",
    name: "Founder 25",
    percent_off: 25,
    amount_off: null,
    currency: null,
    duration: "repeating",
    duration_in_months: 12,
    created: 1_700_000_000,
    livemode: false,
    max_redemptions: 25,
    metadata: {},
    redeem_by: null,
    times_redeemed: 3,
    valid: true,
    ...over,
  };
}

// A Stripe promotion code with the coupon expanded, as returned by
// promotionCodes.list({ expand: ["data.promotion.coupon"] }).
function stripePromo(over: Partial<Stripe.PromotionCode> = {}): Stripe.PromotionCode {
  return {
    id: "promo_1",
    object: "promotion_code",
    code: "FOUNDER25",
    active: true,
    created: 1_700_000_000,
    customer: null,
    customer_account: null,
    expires_at: null,
    livemode: false,
    max_redemptions: 25,
    metadata: {},
    times_redeemed: 3,
    restrictions: { first_time_transaction: false, minimum_amount: null, minimum_amount_currency: null },
    promotion: { type: "coupon", coupon: stripeCoupon() },
    ...over,
  };
}

/** Shorthand for the common "same code, different coupon" fixture. */
function promoWithCoupon(over: Partial<Stripe.Coupon>): Stripe.PromotionCode {
  return stripePromo({ promotion: { type: "coupon", coupon: stripeCoupon(over) } });
}

describe("normalizePromoCode", () => {
  it("uppercases and strips characters Stripe rejects", () => {
    expect(normalizePromoCode(" founder 25! ")).toBe("FOUNDER25");
  });

  it("keeps dashes, which Stripe allows", () => {
    expect(normalizePromoCode("first-year-50")).toBe("FIRST-YEAR-50");
  });

  it("returns null for blank input so Stripe generates the code", () => {
    expect(normalizePromoCode("")).toBeNull();
    expect(normalizePromoCode("   ")).toBeNull();
    expect(normalizePromoCode(null)).toBeNull();
  });
});

describe("buildCouponParams", () => {
  const base = {
    name: "Founder 25",
    discount: { kind: "percent" as const, percentOff: 25 },
    years: 1,
    maxRedemptions: 25,
  };

  it("maps a percent discount", () => {
    const p = buildCouponParams(base);
    expect(p.percent_off).toBe(25);
    expect(p.amount_off).toBeUndefined();
    expect(p.name).toBe("Founder 25");
  });

  it("maps a dollar discount to cents plus a currency", () => {
    const p = buildCouponParams({
      ...base,
      discount: { kind: "amount", amountOffCents: 5000 },
    });
    expect(p.amount_off).toBe(5000);
    expect(p.currency).toBe("usd");
    expect(p.percent_off).toBeUndefined();
  });

  it("expresses N years as N*12 repeating months", () => {
    expect(buildCouponParams({ ...base, years: 1 }).duration_in_months).toBe(12);
    expect(buildCouponParams({ ...base, years: 2 }).duration_in_months).toBe(24);
    expect(buildCouponParams({ ...base, years: 1 }).duration).toBe("repeating");
  });

  it("carries max_redemptions onto the coupon as a backstop", () => {
    expect(buildCouponParams(base).max_redemptions).toBe(25);
  });

  it("rejects a percent outside 1-100", () => {
    expect(() => buildCouponParams({ ...base, discount: { kind: "percent", percentOff: 0 } })).toThrow(/between 1 and 100/);
    expect(() => buildCouponParams({ ...base, discount: { kind: "percent", percentOff: 101 } })).toThrow(/between 1 and 100/);
  });

  it("rejects a non-positive dollar amount", () => {
    expect(() => buildCouponParams({ ...base, discount: { kind: "amount", amountOffCents: 0 } })).toThrow(/greater than \$0/);
  });

  it("rejects a years value outside 1-5", () => {
    expect(() => buildCouponParams({ ...base, years: 0 })).toThrow(/between 1 and 5/);
    expect(() => buildCouponParams({ ...base, years: 6 })).toThrow(/between 1 and 5/);
    expect(() => buildCouponParams({ ...base, years: 1.5 })).toThrow(/between 1 and 5/);
  });

  it("rejects a non-positive redemption limit", () => {
    expect(() => buildCouponParams({ ...base, maxRedemptions: 0 })).toThrow(/at least 1 person/);
  });

  it("rejects a blank name", () => {
    expect(() => buildCouponParams({ ...base, name: "  " })).toThrow(/name/i);
  });
});

describe("buildPromotionCodeParams", () => {
  const base = {
    name: "Founder 25",
    discount: { kind: "percent" as const, percentOff: 25 },
    years: 1,
    maxRedemptions: 25,
  };

  it("points at the coupon using the promotion wrapper", () => {
    const p = buildPromotionCodeParams("coupon_1", base);
    expect(p.promotion).toEqual({ type: "coupon", coupon: "coupon_1" });
  });

  it("passes the normalized code through", () => {
    expect(buildPromotionCodeParams("coupon_1", { ...base, code: "founder 25" }).code).toBe("FOUNDER25");
  });

  it("omits the code entirely when blank so Stripe generates one", () => {
    expect(buildPromotionCodeParams("coupon_1", { ...base, code: "" }).code).toBeUndefined();
  });

  it("caps redemptions at the configured limit", () => {
    expect(buildPromotionCodeParams("coupon_1", base).max_redemptions).toBe(25);
  });

  it("converts an expiry date to unix seconds", () => {
    const p = buildPromotionCodeParams("coupon_1", {
      ...base,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    expect(p.expires_at).toBe(Math.floor(Date.UTC(2027, 0, 1) / 1000));
  });

  it("sets the new-customers-only restriction only when asked", () => {
    expect(buildPromotionCodeParams("coupon_1", base).restrictions).toBeUndefined();
    expect(
      buildPromotionCodeParams("coupon_1", { ...base, firstTimeOnly: true }).restrictions,
    ).toEqual({ first_time_transaction: true });
  });
});

describe("toPromoCodeRow", () => {
  it("labels a percent discount", () => {
    expect(toPromoCodeRow(stripePromo()).discountLabel).toBe("25% off");
  });

  it("labels a dollar discount from cents", () => {
    const row = toPromoCodeRow(
      promoWithCoupon({ percent_off: null, amount_off: 5000, currency: "usd" }),
    );
    expect(row.discountLabel).toBe("$50.00 off");
  });

  it("describes a 12-month coupon as one year", () => {
    expect(toPromoCodeRow(stripePromo()).durationLabel).toBe("1 year");
  });

  it("describes a 24-month coupon as two years", () => {
    expect(toPromoCodeRow(promoWithCoupon({ duration_in_months: 24 })).durationLabel).toBe("2 years");
  });

  it("falls back to months when the coupon is not a whole number of years", () => {
    expect(toPromoCodeRow(promoWithCoupon({ duration_in_months: 3 })).durationLabel).toBe("3 months");
  });

  it("describes the non-repeating durations", () => {
    const once = promoWithCoupon({ duration: "once", duration_in_months: null });
    expect(toPromoCodeRow(once).durationLabel).toBe("First invoice");
    const forever = promoWithCoupon({ duration: "forever", duration_in_months: null });
    expect(toPromoCodeRow(forever).durationLabel).toBe("Forever");
  });

  it("reports how many uses are left", () => {
    const row = toPromoCodeRow(stripePromo({ max_redemptions: 25, times_redeemed: 3 }));
    expect(row.timesRedeemed).toBe(3);
    expect(row.maxRedemptions).toBe(25);
  });

  it("reports an unlimited code with a null ceiling", () => {
    expect(toPromoCodeRow(stripePromo({ max_redemptions: null })).maxRedemptions).toBeNull();
  });

  it("carries the new-customers-only restriction through", () => {
    expect(toPromoCodeRow(stripePromo()).firstTimeOnly).toBe(false);
    const restricted = stripePromo({
      restrictions: { first_time_transaction: true, minimum_amount: null, minimum_amount_currency: null },
    });
    expect(toPromoCodeRow(restricted).firstTimeOnly).toBe(true);
  });

  it("marks a code used up when redemptions hit the limit", () => {
    expect(toPromoCodeRow(stripePromo({ max_redemptions: 5, times_redeemed: 5 })).status).toBe("used up");
  });

  it("marks a past expiry as expired", () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    expect(toPromoCodeRow(stripePromo({ expires_at: past })).status).toBe("expired");
  });

  it("marks a deactivated code inactive", () => {
    expect(toPromoCodeRow(stripePromo({ active: false })).status).toBe("inactive");
  });

  it("marks a live code active", () => {
    expect(toPromoCodeRow(stripePromo()).status).toBe("active");
  });

  it("survives a coupon Stripe did not expand", () => {
    const row = toPromoCodeRow(stripePromo({ promotion: { type: "coupon", coupon: "coupon_1" } }));
    expect(row.discountLabel).toBe("—");
    expect(row.durationLabel).toBe("—");
    expect(row.code).toBe("FOUNDER25");
  });
});

describe("createPromoCode", () => {
  const input = {
    name: "Founder 25",
    discount: { kind: "percent" as const, percentOff: 25 },
    years: 1,
    maxRedemptions: 25,
    code: "FOUNDER25",
  };

  it("creates the coupon first, then the code pointing at it", async () => {
    await createPromoCode(input);
    expect(h.couponCreate).toHaveBeenCalledWith(
      expect.objectContaining({ percent_off: 25, duration_in_months: 12 }),
    );
    expect(h.promoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        promotion: { type: "coupon", coupon: "coupon_1" },
        code: "FOUNDER25",
      }),
    );
  });

  it("returns the customer-facing code Stripe settled on", async () => {
    h.promoCreate.mockResolvedValue({ id: "promo_9", code: "GENERATED7" });
    await expect(createPromoCode({ ...input, code: null })).resolves.toEqual({
      id: "promo_9",
      code: "GENERATED7",
    });
  });

  it("validates before touching Stripe at all", async () => {
    await expect(createPromoCode({ ...input, years: 9 })).rejects.toThrow(/between 1 and 5/);
    expect(h.couponCreate).not.toHaveBeenCalled();
    expect(h.promoCreate).not.toHaveBeenCalled();
  });

  it("deletes the coupon when the code fails, so a duplicate leaves no orphan", async () => {
    h.promoCreate.mockRejectedValue(new Error("The promotion code `FOUNDER25` already exists."));
    await expect(createPromoCode(input)).rejects.toThrow(/already exists/);
    expect(h.couponDel).toHaveBeenCalledWith("coupon_1");
  });

  it("still reports the original failure when cleanup also fails", async () => {
    h.promoCreate.mockRejectedValue(new Error("The promotion code `FOUNDER25` already exists."));
    h.couponDel.mockRejectedValue(new Error("cleanup blew up"));
    await expect(createPromoCode(input)).rejects.toThrow(/already exists/);
  });

  it("leaves the coupon alone when the code is created", async () => {
    await createPromoCode(input);
    expect(h.couponDel).not.toHaveBeenCalled();
  });
});

describe("listPromoCodes", () => {
  it("asks Stripe to expand the coupon so the discount is readable", async () => {
    await listPromoCodes();
    expect(h.promoList).toHaveBeenCalledWith(
      expect.objectContaining({ expand: ["data.promotion.coupon"] }),
    );
  });

  it("maps every code Stripe returns", async () => {
    h.promoList.mockResolvedValue({
      data: [stripePromo(), stripePromo({ id: "promo_2", code: "SPRING10" })],
      has_more: false,
    });
    const res = await listPromoCodes();
    expect(res.rows.map((r) => r.code)).toEqual(["FOUNDER25", "SPRING10"]);
    expect(res.truncated).toBe(false);
  });

  it("reports a capped list rather than passing it off as complete", async () => {
    h.promoList.mockResolvedValue({ data: [stripePromo()], has_more: true });
    expect((await listPromoCodes()).truncated).toBe(true);
  });
});

describe("deactivatePromoCode", () => {
  it("flips the code inactive without deleting history", async () => {
    await deactivatePromoCode("promo_1");
    expect(h.promoUpdate).toHaveBeenCalledWith("promo_1", { active: false });
  });

  it("rejects a missing id", async () => {
    await expect(deactivatePromoCode("")).rejects.toThrow(/code id/i);
  });
});
