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
vi.mock("@/lib/billing/portal-plan-switch", () => ({
  getPlanSwitchPortalConfigurationId: vi.fn().mockResolvedValue("bpc_switch"),
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
import { getPlanSwitchPortalConfigurationId } from "@/lib/billing/portal-plan-switch";

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

function portalRequest(plan?: string): Request {
  const body = new URLSearchParams();
  if (plan) body.set("plan", plan);
  return new Request("https://app.foundryplanning.com/api/billing/portal", {
    method: "POST",
    body,
  });
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

    const res = await POST(portalRequest());

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://billing.stripe.com/session/test_xyz",
    );
    expect(create).toHaveBeenCalledWith({
      customer: "cus_123",
      return_url: "https://app.foundryplanning.com/settings/billing",
    });
  });

  it("400s with no_subscription when the firm has no Stripe customer", async () => {
    mockSubscriptionRows([]);
    const create = vi.fn();
    vi.mocked(getStripe).mockReturnValue({
      billingPortal: { sessions: { create } },
    } as never);

    const res = await POST(portalRequest());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no_subscription" });
    expect(create).not.toHaveBeenCalled();
  });

  it("403s when the caller is not the org owner", async () => {
    vi.mocked(requireBillingContact).mockRejectedValue(
      new ForbiddenError("Organization owner role required"),
    );
    const res = await POST(portalRequest());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Organization owner role required",
    });
  });

  it("401s when there is no session", async () => {
    vi.mocked(requireBillingContact).mockRejectedValue(new UnauthorizedError());
    const res = await POST(portalRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("400s with no_subscription when the org id is missing", async () => {
    vi.mocked(auth).mockResolvedValue({ orgId: null } as never);
    const res = await POST(portalRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no_subscription" });
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

    const res = await POST(portalRequest());

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

    const res = await POST(portalRequest());

    expect(res.status).toBe(303);
    expect(create).toHaveBeenCalledWith({
      customer: "cus_123",
      return_url: "https://app.foundryplanning.com/settings/billing",
    });
  });

  it("500s when Stripe throws creating the session", async () => {
    mockSubscriptionRows([{ stripeCustomerId: "cus_123" }]);
    vi.mocked(getStripe).mockReturnValue({
      billingPortal: {
        sessions: { create: vi.fn().mockRejectedValue(new Error("boom")) },
      },
    } as never);

    const res = await POST(portalRequest());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "portal_unavailable" });
  });

  it("opens a Stripe confirmation to switch an annual trial to monthly", async () => {
    mockSubscriptionRows([{
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      status: "trialing",
      cancelAtPeriodEnd: false,
    }]);
    const create = vi
      .fn()
      .mockResolvedValue({ url: "https://billing.stripe.com/session/switch" });
    const retrieve = vi.fn().mockResolvedValue({
      id: "sub_123",
      status: "trialing",
      items: {
        data: [{
          id: "si_seat",
          price: { id: "price_annual" },
          quantity: 4,
        }],
      },
    });
    vi.mocked(getStripe).mockReturnValue({
      subscriptions: { retrieve },
      billingPortal: { sessions: { create } },
    } as never);
    const res = await POST(portalRequest("monthly"));

    expect(res.status).toBe(303);
    expect(retrieve).toHaveBeenCalledWith("sub_123");
    expect(getPlanSwitchPortalConfigurationId).toHaveBeenCalledWith(
      expect.anything(),
      { deferToPeriodEnd: false },
    );
    expect(create).toHaveBeenCalledWith({
      customer: "cus_123",
      return_url: "https://app.foundryplanning.com/settings/billing",
      configuration: "bpc_switch",
      flow_data: {
        type: "subscription_update_confirm",
        subscription_update_confirm: {
          subscription: "sub_123",
          items: [{ id: "si_seat", price: "price_monthly", quantity: 4 }],
        },
        after_completion: {
          type: "redirect",
          redirect: {
            return_url: "https://app.foundryplanning.com/settings/billing?plan_changed=1",
          },
        },
      },
    });
  });

  /**
   * The mirror of the trial case. A paid year cannot be re-anchored a month
   * out, so Stripe schedules this one — and the page has to say so, because
   * the cycle on screen legitimately will not move until the period ends.
   */
  it("schedules an annual downgrade that has already been paid for", async () => {
    mockSubscriptionRows([{
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      status: "active",
      cancelAtPeriodEnd: false,
    }]);
    const create = vi
      .fn()
      .mockResolvedValue({ url: "https://billing.stripe.com/session/switch" });
    const retrieve = vi.fn().mockResolvedValue({
      id: "sub_123",
      status: "active",
      items: {
        data: [{ id: "si_seat", price: { id: "price_annual" }, quantity: 1 }],
      },
    });
    vi.mocked(getStripe).mockReturnValue({
      subscriptions: { retrieve },
      billingPortal: { sessions: { create } },
    } as never);

    const res = await POST(portalRequest("monthly"));

    expect(res.status).toBe(303);
    expect(getPlanSwitchPortalConfigurationId).toHaveBeenCalledWith(
      expect.anything(),
      { deferToPeriodEnd: true },
    );
    expect(create.mock.calls[0][0].flow_data.after_completion.redirect.return_url)
      .toBe("https://app.foundryplanning.com/settings/billing?plan_changed=scheduled");
  });

  it("rejects a forged billing-cycle value", async () => {
    mockSubscriptionRows([{
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      status: "active",
      cancelAtPeriodEnd: false,
    }]);
    const create = vi.fn();
    vi.mocked(getStripe).mockReturnValue({
      billingPortal: { sessions: { create } },
    } as never);
    const res = await POST(portalRequest("weekly"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_plan" });
    expect(create).not.toHaveBeenCalled();
  });

  it("does not change a plan that is already scheduled to cancel", async () => {
    mockSubscriptionRows([{
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      status: "active",
      cancelAtPeriodEnd: true,
    }]);
    const create = vi.fn();
    const retrieve = vi.fn();
    vi.mocked(getStripe).mockReturnValue({
      subscriptions: { retrieve },
      billingPortal: { sessions: { create } },
    } as never);

    const res = await POST(portalRequest("monthly"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "plan_change_unavailable" });
    expect(retrieve).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
