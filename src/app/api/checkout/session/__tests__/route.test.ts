import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkCheckoutSessionRateLimit: vi.fn(),
}));
vi.mock("@/lib/billing/price-catalog", () => ({
  getPriceCatalog: vi.fn(() => ({
    seatMonthly: "price_test_monthly",
    seatAnnual: "price_test_annual",
    seatFoundingAnnual: "price_test_founding",
    aiImportMonthly: "price_test_ai",
  })),
}));

import { POST } from "../route";
import { getStripe } from "@/lib/billing/stripe-client";
import { checkCheckoutSessionRateLimit } from "@/lib/rate-limit";

describe("POST /api/checkout/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkCheckoutSessionRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 9,
      reset: Date.now() + 60_000,
    });
  });

  function makeRequest(body: unknown, headers: Record<string, string> = {}) {
    return new Request("https://app.foundryplanning.com/api/checkout/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.foundryplanning.com",
        "x-forwarded-for": "203.0.113.7",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }

  it("returns the Stripe Checkout URL for a valid priceKey", async () => {
    vi.mocked(getStripe).mockReturnValue({
      checkout: {
        sessions: {
          create: vi
            .fn()
            .mockResolvedValue({ id: "cs_test_abc", url: "https://checkout.stripe.com/c/cs_test_abc" }),
        },
      },
    } as never);

    const res = await POST(makeRequest({ priceKey: "seatMonthly" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: "https://checkout.stripe.com/c/cs_test_abc",
    });
  });

  it("400s on invalid priceKey", async () => {
    const res = await POST(makeRequest({ priceKey: "seatFoundingAnnual" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_price_key" });
  });

  it("400s on missing body", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("429s when the rate limiter denies", async () => {
    vi.mocked(checkCheckoutSessionRateLimit).mockResolvedValue({
      allowed: false,
      reason: "exceeded",
      remaining: 0,
      reset: Date.now() + 30_000,
    });
    const res = await POST(makeRequest({ priceKey: "seatMonthly" }));
    expect(res.status).toBe(429);
  });

  it("500s when Stripe throws", async () => {
    vi.mocked(getStripe).mockReturnValue({
      checkout: {
        sessions: { create: vi.fn().mockRejectedValue(new Error("boom")) },
      },
    } as never);
    const res = await POST(makeRequest({ priceKey: "seatMonthly" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "checkout_unavailable" });
  });
});
