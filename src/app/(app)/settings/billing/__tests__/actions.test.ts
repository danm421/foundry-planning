import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  requireBillingContact: vi.fn(),
  state: vi.fn(),
  rateLimit: vi.fn(),
  sessionsCreate: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: () => h.auth() }));
vi.mock("@/lib/authz", () => ({
  requireBillingContact: () => h.requireBillingContact(),
}));
vi.mock("@/lib/billing/subscription-state", () => ({
  getSubscriptionState: () => h.state(),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkCheckoutSessionRateLimit: (k: string) => h.rateLimit(k),
}));
vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({ checkout: { sessions: { create: (p: unknown) => h.sessionsCreate(p) } } }),
}));
vi.mock("@/lib/billing/price-catalog", () => ({
  getPriceCatalog: () => ({
    seatMonthly: "price_monthly",
    seatAnnual: "price_annual",
    seatFoundingAnnual: "price_founding",
  }),
}));

import { startResubscribeCheckout } from "../actions";

const ORG = "org_3GunIfnXQ7DQRQsfjlrha36CgDh";

function fd(plan?: string) {
  const f = new FormData();
  if (plan) f.set("plan", plan);
  return f;
}

beforeEach(() => {
  h.auth.mockReset().mockResolvedValue({ userId: "user_owner", orgId: ORG });
  h.requireBillingContact.mockReset().mockResolvedValue(undefined);
  h.state.mockReset().mockResolvedValue({ kind: "comp_ended" });
  h.rateLimit.mockReset().mockResolvedValue({ allowed: true });
  h.sessionsCreate
    .mockReset()
    .mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_1" });
});

describe("startResubscribeCheckout", () => {
  it("returns a Stripe URL for a comp_ended firm", async () => {
    await expect(startResubscribeCheckout(fd("annual"))).resolves.toEqual({
      ok: true,
      url: "https://checkout.stripe.com/c/pay/cs_1",
    });
  });

  it("binds the session to the caller's own org — the anti-stranding guard", async () => {
    await startResubscribeCheckout(fd("annual"));
    const params = h.sessionsCreate.mock.calls[0][0] as {
      metadata?: { firm_id?: string };
      subscription_data?: { metadata?: { firm_id?: string }; trial_period_days?: number };
    };
    expect(params.metadata?.firm_id).toBe(ORG);
    expect(params.subscription_data?.metadata?.firm_id).toBe(ORG);
    expect(params.subscription_data?.trial_period_days).toBeUndefined();
  });

  it("prices the plan the caller picked", async () => {
    await startResubscribeCheckout(fd("monthly"));
    const params = h.sessionsCreate.mock.calls[0][0] as {
      line_items: { price: string }[];
    };
    expect(params.line_items[0].price).toBe("price_monthly");
  });

  it("refuses a `missing` firm — that is a broken account, not a comp that ended", async () => {
    // Offering checkout here could mint a duplicate subscription for a firm
    // whose metadata merely failed to write. This refusal is the reason
    // comp_ended is a distinct state rather than a reuse of missing.
    h.state.mockResolvedValue({ kind: "missing", reason: "no_metadata" });
    await expect(startResubscribeCheckout(fd("annual"))).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/isn't waiting on a subscription/i),
    });
    expect(h.sessionsCreate).not.toHaveBeenCalled();
  });

  it("refuses an already-active firm", async () => {
    h.state.mockResolvedValue({ kind: "active" });
    const res = await startResubscribeCheckout(fd("annual"));
    expect(res.ok).toBe(false);
    expect(h.sessionsCreate).not.toHaveBeenCalled();
  });

  it("refuses a canceled firm — its route back is the billing portal", async () => {
    h.state.mockResolvedValue({ kind: "canceled_locked" });
    const res = await startResubscribeCheckout(fd("annual"));
    expect(res.ok).toBe(false);
    expect(h.sessionsCreate).not.toHaveBeenCalled();
  });

  it("is gated to the billing contact", async () => {
    h.requireBillingContact.mockRejectedValue(new Error("Billing contact access required"));
    await expect(startResubscribeCheckout(fd("annual"))).rejects.toThrow(/billing contact/i);
    expect(h.sessionsCreate).not.toHaveBeenCalled();
  });

  it("honours the rate limit", async () => {
    h.rateLimit.mockResolvedValue({ allowed: false });
    const res = await startResubscribeCheckout(fd("annual"));
    expect(res.ok).toBe(false);
    expect(h.sessionsCreate).not.toHaveBeenCalled();
  });

  it("keys the budget on the user, not the IP", async () => {
    await startResubscribeCheckout(fd("annual"));
    expect(h.rateLimit).toHaveBeenCalledWith("user:user_owner");
  });

  it("returns an inline error rather than throwing when Stripe is down", async () => {
    // This page is the ONLY surface a read-only firm can act on — an uncaught
    // throw would replace it with the error boundary.
    h.sessionsCreate.mockRejectedValue(new Error("stripe is down"));
    const res = await startResubscribeCheckout(fd("annual"));
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/couldn't reach payments/i) });
  });
});
