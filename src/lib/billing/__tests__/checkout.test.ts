import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildCheckoutSessionParams } from "../checkout";
import { __resetPriceCatalogForTests } from "../price-catalog";

const ENV = {
  STRIPE_PRICE_ID_SEAT_MONTHLY: "price_test_monthly",
  STRIPE_PRICE_ID_SEAT_ANNUAL: "price_test_annual",
  STRIPE_PRICE_ID_SEAT_FOUNDING_ANNUAL: "price_test_founding",
  STRIPE_PRICE_ID_AI_IMPORT_MONTHLY: "price_test_ai",
} as const;

describe("buildCheckoutSessionParams", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(
      Object.keys(ENV).map((k) => [k, process.env[k]]),
    );
    Object.assign(process.env, ENV);
    __resetPriceCatalogForTests();
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    __resetPriceCatalogForTests();
  });

  it("resolves seatMonthly priceKey to the monthly price ID", () => {
    const params = buildCheckoutSessionParams({
      priceKey: "seatMonthly",
      origin: "https://app.foundryplanning.com",
    });
    expect(params.line_items).toEqual([
      { price: "price_test_monthly", quantity: 1 },
    ]);
  });

  it("resolves seatAnnual priceKey to the annual price ID", () => {
    const params = buildCheckoutSessionParams({
      priceKey: "seatAnnual",
      origin: "https://app.foundryplanning.com",
    });
    expect(params.line_items).toEqual([
      { price: "price_test_annual", quantity: 1 },
    ]);
  });

  it("appends the AI Import line item when withAiImport is true", () => {
    const params = buildCheckoutSessionParams({
      priceKey: "seatAnnual",
      origin: "https://app.foundryplanning.com",
      withAiImport: true,
    });
    expect(params.line_items).toEqual([
      { price: "price_test_annual", quantity: 1 },
      { price: "price_test_ai", quantity: 1 },
    ]);
  });

  it("omits the AI Import line item when withAiImport is false or absent", () => {
    const off = buildCheckoutSessionParams({
      priceKey: "seatMonthly",
      origin: "https://app.foundryplanning.com",
      withAiImport: false,
    });
    expect(off.line_items).toHaveLength(1);
    const omitted = buildCheckoutSessionParams({
      priceKey: "seatMonthly",
      origin: "https://app.foundryplanning.com",
    });
    expect(omitted.line_items).toHaveLength(1);
  });

  it("sets a 14-day trial via subscription_data", () => {
    const params = buildCheckoutSessionParams({
      priceKey: "seatMonthly",
      origin: "https://app.foundryplanning.com",
    });
    expect(params.subscription_data).toEqual({ trial_period_days: 14 });
  });

  it("requires ToS consent and a firm_name custom field", () => {
    const params = buildCheckoutSessionParams({
      priceKey: "seatMonthly",
      origin: "https://app.foundryplanning.com",
    });
    expect(params.consent_collection?.terms_of_service).toBe("required");
    expect(params.custom_fields).toEqual([
      {
        key: "firm_name",
        label: { type: "custom", custom: "Firm Name" },
        type: "text",
      },
    ]);
  });

  it("templates success_url with the literal {CHECKOUT_SESSION_ID} token", () => {
    const params = buildCheckoutSessionParams({
      priceKey: "seatMonthly",
      origin: "https://example.test",
    });
    expect(params.success_url).toBe(
      "https://example.test/checkout/success?session_id={CHECKOUT_SESSION_ID}",
    );
    expect(params.cancel_url).toBe("https://example.test/pricing");
  });

  it("enables automatic_tax and forces customer creation", () => {
    const params = buildCheckoutSessionParams({
      priceKey: "seatMonthly",
      origin: "https://example.test",
    });
    expect(params.automatic_tax).toEqual({ enabled: true });
    expect(params.customer_creation).toBe("always");
    expect(params.mode).toBe("subscription");
    expect(params.payment_method_types).toEqual(["card"]);
  });
});
