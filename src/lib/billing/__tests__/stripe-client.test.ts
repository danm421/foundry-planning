import { describe, it, expect, beforeEach, vi } from "vitest";

describe("getStripe", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
  });

  it("returns the same instance across calls (singleton)", async () => {
    const { getStripe } = await import("../stripe-client");
    expect(getStripe()).toBe(getStripe());
  });

  it("throws when STRIPE_SECRET_KEY is missing", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { getStripe } = await import("../stripe-client");
    expect(() => getStripe()).toThrow(/STRIPE_SECRET_KEY/);
  });
});
