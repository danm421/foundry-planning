import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: vi.fn(),
}));
vi.mock("@/lib/billing/price-catalog", () => ({
  getPriceCatalog: () => ({
    seatMonthly: "price_monthly",
    seatAnnual: "price_annual",
    seatFoundingAnnual: "price_founding",
  }),
}));
vi.mock("@/lib/authz", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireBillingContact: vi.fn() };
});
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));
vi.mock("@/db", () => ({
  db: { select: vi.fn() },
}));
vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(),
}));

import { POST } from "../route";
import { getStripe } from "@/lib/billing/stripe-client";
import { requireBillingContact, ForbiddenError } from "@/lib/authz";
import { UnauthorizedError } from "@/lib/db-helpers";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { recordAudit } from "@/lib/audit";

// db.select().from().where().orderBy() resolves to an array of rows.
function mockSubscriptionRows(rows: {
  stripeCustomerId: string;
  stripeSubscriptionId?: string;
  status?: string;
  cancelAtPeriodEnd?: boolean;
}[]) {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(rows),
      }),
    }),
  } as never);
}

describe("POST /api/billing/portal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.foundryplanning.com");
    vi.mocked(requireBillingContact).mockResolvedValue(undefined);
    vi.mocked(auth).mockResolvedValue({ orgId: "org_abc" } as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a portal session and 303-redirects to its URL", async () => {
    mockSubscriptionRows([{ stripeCustomerId: "cus_123" }]);
    const create = vi
      .fn()
      .mockResolvedValue({ url: "https://billing.stripe.com/session/test_xyz" });
    vi.mocked(getStripe).mockReturnValue({
      billingPortal: { sessions: { create } },
    } as never);

    const res = await POST();

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://billing.stripe.com/session/test_xyz",
    );
    expect(create).toHaveBeenCalledWith({
      customer: "cus_123",
      return_url: "https://app.foundryplanning.com/settings/billing",
    });
  });

  it("sends a firm with no Stripe customer back to the billing page", async () => {
    mockSubscriptionRows([]);
    const create = vi.fn();
    vi.mocked(getStripe).mockReturnValue({
      billingPortal: { sessions: { create } },
    } as never);

    const res = await POST();

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://app.foundryplanning.com/settings/billing?billing_error=no_subscription",
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("403s when the caller is not the org owner", async () => {
    vi.mocked(requireBillingContact).mockRejectedValue(
      new ForbiddenError("Organization owner role required"),
    );
    const res = await POST();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Organization owner role required",
    });
  });

  it("401s when there is no session", async () => {
    vi.mocked(requireBillingContact).mockRejectedValue(new UnauthorizedError());
    const res = await POST();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("sends a request with no org id back to the billing page", async () => {
    vi.mocked(auth).mockResolvedValue({ orgId: null } as never);
    const res = await POST();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://app.foundryplanning.com/settings/billing?billing_error=no_subscription",
    );
  });

  // The handler takes no Request at all, so the caller's Origin header cannot
  // reach return_url by construction. These two cover the only inputs left.
  it("builds return_url from NEXT_PUBLIC_APP_URL, not from the request", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.foundryplanning.com");
    mockSubscriptionRows([{ stripeCustomerId: "cus_123" }]);
    const create = vi
      .fn()
      .mockResolvedValue({ url: "https://billing.stripe.com/session/test_cfg" });
    vi.mocked(getStripe).mockReturnValue({
      billingPortal: { sessions: { create } },
    } as never);

    const res = await POST();

    expect(res.status).toBe(303);
    expect(create).toHaveBeenCalledWith({
      customer: "cus_123",
      return_url: "https://staging.foundryplanning.com/settings/billing",
    });
  });

  it("falls back to the production host when NEXT_PUBLIC_APP_URL is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
    mockSubscriptionRows([{ stripeCustomerId: "cus_123" }]);
    const create = vi
      .fn()
      .mockResolvedValue({ url: "https://billing.stripe.com/session/test_default" });
    vi.mocked(getStripe).mockReturnValue({
      billingPortal: { sessions: { create } },
    } as never);

    const res = await POST();

    expect(res.status).toBe(303);
    expect(create).toHaveBeenCalledWith({
      customer: "cus_123",
      return_url: "https://app.foundryplanning.com/settings/billing",
    });
  });

  /**
   * A native form POST is the only caller, so a JSON error body is not an API
   * response — it is a blank page reading `{"error":"portal_unavailable"}`,
   * which is exactly how the schedule bug below reached a customer.
   */
  it("sends a Stripe failure back to the billing page, not to a JSON body", async () => {
    mockSubscriptionRows([{ stripeCustomerId: "cus_123" }]);
    vi.mocked(getStripe).mockReturnValue({
      billingPortal: {
        sessions: { create: vi.fn().mockRejectedValue(new Error("boom")) },
      },
    } as never);

    const res = await POST();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://app.foundryplanning.com/settings/billing?billing_error=portal_unavailable",
    );
  });

  /**
   * Cycle changes left this route entirely. Stripe ignores the portal
   * configuration's `schedule_at_period_end.conditions` inside a
   * `subscription_update_confirm` flow, so a paid downgrade opened here
   * applied immediately and binned the remaining paid months. The handler now
   * takes no request at all — there is no body for a plan to arrive in — and
   * it opens only a plain portal session.
   */
  it("opens a plain portal session with no switch flow attached", async () => {
    mockSubscriptionRows([{ stripeCustomerId: "cus_123" }]);
    const create = vi
      .fn()
      .mockResolvedValue({ url: "https://billing.stripe.com/session/test_xyz" });
    vi.mocked(getStripe).mockReturnValue({
      billingPortal: { sessions: { create } },
    } as never);

    const res = await POST();

    expect(res.status).toBe(303);
    const params = create.mock.calls[0][0];
    expect(params).not.toHaveProperty("flow_data");
    expect(params).not.toHaveProperty("configuration");
    expect(params).toMatchObject({ customer: "cus_123" });
    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { flow: "portal_home" } }),
    );
  });
});
