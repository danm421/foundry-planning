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

/** Every catalog var set to a recognisable value. */
function setAll(): void {
  process.env.STRIPE_PRICE_ID_SEAT_MONTHLY = "price_seat_m";
  process.env.STRIPE_PRICE_ID_SEAT_ANNUAL = "price_seat_a";
  process.env.STRIPE_PRICE_ID_SEAT_FOUNDING_ANNUAL = "price_seat_fa";
  process.env.STRIPE_PRICE_ID_AI_IMPORT_MONTHLY = "price_ai_m";
}

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

  it("returns every price ID from env", () => {
    setAll();
    expect(getPriceCatalog()).toEqual({
      seatMonthly: "price_seat_m",
      seatAnnual: "price_seat_a",
      seatFoundingAnnual: "price_seat_fa",
      aiImportMonthly: "price_ai_m",
    });
  });

  it("throws when a required env var is missing", () => {
    process.env.STRIPE_PRICE_ID_SEAT_MONTHLY = "price_seat_m";
    process.env.STRIPE_PRICE_ID_SEAT_ANNUAL = "price_seat_a";
    process.env.STRIPE_PRICE_ID_AI_IMPORT_MONTHLY = "price_ai_m";
    expect(() => getPriceCatalog()).toThrow(/STRIPE_PRICE_ID_SEAT_FOUNDING_ANNUAL/);
  });

  // The add-on is in the catalog so the promo guard can see it. If its var is
  // missing the whole catalog throws — that is the point, but it means the var
  // has to exist everywhere the catalog is read, not just where promos are made.
  it("names the add-on var when only that one is missing", () => {
    process.env.STRIPE_PRICE_ID_SEAT_MONTHLY = "price_seat_m";
    process.env.STRIPE_PRICE_ID_SEAT_ANNUAL = "price_seat_a";
    process.env.STRIPE_PRICE_ID_SEAT_FOUNDING_ANNUAL = "price_seat_fa";
    expect(() => getPriceCatalog()).toThrow(/STRIPE_PRICE_ID_AI_IMPORT_MONTHLY/);
  });

  it("caches result across calls", () => {
    setAll();
    const a = getPriceCatalog();
    process.env.STRIPE_PRICE_ID_SEAT_MONTHLY = "price_changed";
    const b = getPriceCatalog();
    expect(a).toBe(b);
  });

  it("priceKindFor separates seats from add-ons and returns null for unknown", async () => {
    const { priceKindFor } = await import("../price-catalog");
    setAll();
    __resetPriceCatalogForTests();
    expect(priceKindFor("price_seat_m")).toBe("seat");
    expect(priceKindFor("price_seat_a")).toBe("seat");
    expect(priceKindFor("price_seat_fa")).toBe("seat");
    expect(priceKindFor("price_ai_m")).toBe("addon");
    expect(priceKindFor("price_unknown")).toBe(null);
  });
});
