import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkCheckoutSessionRateLimit: vi.fn(),
  extractClientIp: vi.fn(() => "203.0.113.7"),
}));

import { GET } from "../route";
import { getStripe } from "@/lib/billing/stripe-client";
import { checkCheckoutSessionRateLimit } from "@/lib/rate-limit";
import { __resetPriceCatalogForTests } from "@/lib/billing/price-catalog";

const ENV = {
  STRIPE_PRICE_ID_SEAT_MONTHLY: "price_test_monthly",
  STRIPE_PRICE_ID_SEAT_ANNUAL: "price_test_annual",
  STRIPE_PRICE_ID_SEAT_FOUNDING_ANNUAL: "price_test_founding",
  NEXT_PUBLIC_APP_URL: "https://app.example.test",
} as const;

const UNAVAILABLE = "https://app.example.test/checkout/unavailable";

function makeRequest(query = "") {
  return new Request(`https://app.example.test/api/checkout/start${query}`, {
    headers: { "x-forwarded-for": "203.0.113.7" },
  });
}

/** Mocks Stripe and hands back the create spy so tests can read the params. */
function mockStripe(url: string | null = "https://checkout.stripe.com/c/pay/cs_test_1") {
  const create = vi.fn().mockResolvedValue({ id: "cs_test_1", url });
  vi.mocked(getStripe).mockReturnValue({
    checkout: { sessions: { create } },
  } as never);
  return create;
}

describe("GET /api/checkout/start", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    vi.clearAllMocks();
    saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
    Object.assign(process.env, ENV);
    __resetPriceCatalogForTests();
    vi.mocked(checkCheckoutSessionRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 9,
      reset: 1_000,
    });
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    __resetPriceCatalogForTests();
    vi.restoreAllMocks();
  });

  it("redirects the buyer to the Stripe-hosted checkout", async () => {
    mockStripe("https://checkout.stripe.com/c/pay/cs_test_1");
    const res = await GET(makeRequest("?plan=annual"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://checkout.stripe.com/c/pay/cs_test_1",
    );
  });

  it("never lets a shared cache reuse one buyer's checkout session", async () => {
    // A cached 303 would funnel every visitor into the first buyer's session.
    mockStripe();
    const res = await GET(makeRequest("?plan=annual"));
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("buys the annual seat on ?plan=annual", async () => {
    const create = mockStripe();
    await GET(makeRequest("?plan=annual"));
    expect(create.mock.calls[0]![0].line_items).toEqual([
      { price: "price_test_annual", quantity: 1 },
    ]);
  });

  it("buys the monthly seat on ?plan=monthly", async () => {
    const create = mockStripe();
    await GET(makeRequest("?plan=monthly"));
    expect(create.mock.calls[0]![0].line_items).toEqual([
      { price: "price_test_monthly", quantity: 1 },
    ]);
  });

  it("defaults to annual when no plan is named", async () => {
    // The storefront's nav "Start trial" button carries no plan, and annual is
    // the price the site shows by default.
    const create = mockStripe();
    await GET(makeRequest());
    expect(create.mock.calls[0]![0].line_items).toEqual([
      { price: "price_test_annual", quantity: 1 },
    ]);
  });

  it("defaults to annual on an unrecognized plan rather than failing", async () => {
    const create = mockStripe();
    await GET(makeRequest("?plan=lifetime"));
    expect(create.mock.calls[0]![0].line_items).toEqual([
      { price: "price_test_annual", quantity: 1 },
    ]);
  });

  it("sends the buyer back to this app's success page", async () => {
    const create = mockStripe();
    await GET(makeRequest("?plan=annual"));
    expect(create.mock.calls[0]![0].success_url).toBe(
      "https://app.example.test/checkout/success?session_id={CHECKOUT_SESSION_ID}",
    );
  });

  it("rate limits by IP so the endpoint can't be used to mint Stripe sessions", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const create = mockStripe();
    vi.mocked(checkCheckoutSessionRateLimit).mockResolvedValue({
      allowed: false,
      reason: "limited",
      reset: 30_000,
    } as never);
    const res = await GET(makeRequest("?plan=annual"));
    expect(create).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe(UNAVAILABLE);
  });

  it("lands the buyer on an explanation instead of a stack trace when Stripe fails", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getStripe).mockReturnValue({
      checkout: {
        sessions: { create: vi.fn().mockRejectedValue(new Error("boom")) },
      },
    } as never);
    const res = await GET(makeRequest("?plan=annual"));
    expect(res.headers.get("location")).toBe(UNAVAILABLE);
    expect(errors).toHaveBeenCalled();
  });

  it("does the same when a price ID is missing from the environment", async () => {
    // Previews and local dev deliberately lack the Stripe price IDs.
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.STRIPE_PRICE_ID_SEAT_ANNUAL;
    __resetPriceCatalogForTests();
    const create = mockStripe();
    const res = await GET(makeRequest("?plan=annual"));
    expect(create).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe(UNAVAILABLE);
  });

  it("does not redirect to an empty location when Stripe returns no URL", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockStripe(null);
    const res = await GET(makeRequest("?plan=annual"));
    expect(res.headers.get("location")).toBe(UNAVAILABLE);
  });
});
