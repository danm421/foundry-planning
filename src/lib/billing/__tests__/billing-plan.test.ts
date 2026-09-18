import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetPriceCatalogForTests } from "../price-catalog";
import { billingPlanForPriceId } from "../billing-plan";

beforeEach(() => {
  vi.stubEnv("STRIPE_PRICE_ID_SEAT_MONTHLY", "price_monthly");
  vi.stubEnv("STRIPE_PRICE_ID_SEAT_ANNUAL", "price_annual");
  vi.stubEnv("STRIPE_PRICE_ID_SEAT_FOUNDING_ANNUAL", "price_founding");
  __resetPriceCatalogForTests();
});

describe("billingPlanForPriceId", () => {
  it("recognizes public monthly and annual seat prices", () => {
    expect(billingPlanForPriceId("price_monthly")).toBe("monthly");
    expect(billingPlanForPriceId("price_annual")).toBe("annual");
  });

  it("does not offer a public cycle switch for a founding price", () => {
    expect(billingPlanForPriceId("price_founding")).toBeNull();
  });
});
