import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getPriceCatalog,
  __resetPriceCatalogForTests,
} from "../price-catalog";

const ENV_KEYS = [
  "STRIPE_PRICE_ID_SEAT_MONTHLY",
  "STRIPE_PRICE_ID_SEAT_ANNUAL",
  "STRIPE_PRICE_ID_SEAT_FOUNDING_ANNUAL",
  "STRIPE_PRICE_ID_AI_IMPORT_MONTHLY",
] as const;

describe("getPriceCatalog", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    __resetPriceCatalogForTests();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    __resetPriceCatalogForTests();
  });

  it("returns all four price IDs from env", () => {
    process.env.STRIPE_PRICE_ID_SEAT_MONTHLY = "price_seat_m";
    process.env.STRIPE_PRICE_ID_SEAT_ANNUAL = "price_seat_a";
    process.env.STRIPE_PRICE_ID_SEAT_FOUNDING_ANNUAL = "price_seat_fa";
    process.env.STRIPE_PRICE_ID_AI_IMPORT_MONTHLY = "price_ai";
    expect(getPriceCatalog()).toEqual({
      seatMonthly: "price_seat_m",
      seatAnnual: "price_seat_a",
      seatFoundingAnnual: "price_seat_fa",
      aiImportMonthly: "price_ai",
    });
  });

  it("throws when a required env var is missing", () => {
    process.env.STRIPE_PRICE_ID_SEAT_MONTHLY = "price_seat_m";
    process.env.STRIPE_PRICE_ID_SEAT_ANNUAL = "price_seat_a";
    process.env.STRIPE_PRICE_ID_AI_IMPORT_MONTHLY = "price_ai";
    expect(() => getPriceCatalog()).toThrow(/STRIPE_PRICE_ID_SEAT_FOUNDING_ANNUAL/);
  });

  it("caches result across calls", () => {
    process.env.STRIPE_PRICE_ID_SEAT_MONTHLY = "price_seat_m";
    process.env.STRIPE_PRICE_ID_SEAT_ANNUAL = "price_seat_a";
    process.env.STRIPE_PRICE_ID_SEAT_FOUNDING_ANNUAL = "price_seat_fa";
    process.env.STRIPE_PRICE_ID_AI_IMPORT_MONTHLY = "price_ai";
    const a = getPriceCatalog();
    process.env.STRIPE_PRICE_ID_SEAT_MONTHLY = "price_changed";
    const b = getPriceCatalog();
    expect(a).toBe(b);
  });

  it("priceKindFor classifies known IDs", async () => {
    const { priceKindFor } = await import("../price-catalog");
    process.env.STRIPE_PRICE_ID_SEAT_MONTHLY = "price_seat_m";
    process.env.STRIPE_PRICE_ID_SEAT_ANNUAL = "price_seat_a";
    process.env.STRIPE_PRICE_ID_SEAT_FOUNDING_ANNUAL = "price_seat_fa";
    process.env.STRIPE_PRICE_ID_AI_IMPORT_MONTHLY = "price_ai";
    __resetPriceCatalogForTests();
    expect(priceKindFor("price_seat_m")).toBe("seat");
    expect(priceKindFor("price_seat_a")).toBe("seat");
    expect(priceKindFor("price_seat_fa")).toBe("seat");
    expect(priceKindFor("price_ai")).toBe("addon:ai_import");
    expect(priceKindFor("price_unknown")).toBe(null);
  });
});
