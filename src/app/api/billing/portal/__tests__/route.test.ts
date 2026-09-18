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

function portalRequest(plan?: string, replaceSchedule?: string): Request {
  const body = new URLSearchParams();
  if (plan) body.set("plan", plan);
  if (replaceSchedule) body.set("replace_schedule", replaceSchedule);
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

  it("sends a firm with no Stripe customer back to the billing page", async () => {
    mockSubscriptionRows([]);
    const create = vi.fn();
    vi.mocked(getStripe).mockReturnValue({
      billingPortal: { sessions: { create } },
    } as never);

    const res = await POST(portalRequest());

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

  it("sends a request with no org id back to the billing page", async () => {
    vi.mocked(auth).mockResolvedValue({ orgId: null } as never);
    const res = await POST(portalRequest());
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

    const res = await POST(portalRequest());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://app.foundryplanning.com/settings/billing?billing_error=portal_unavailable",
    );
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

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://app.foundryplanning.com/settings/billing?billing_error=invalid_plan",
    );
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

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://app.foundryplanning.com/settings/billing?billing_error=plan_change_unavailable",
    );
    expect(retrieve).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  // Stripe refuses plan-switch sessions while a schedule owns the subscription.
  it("releases a confirmed trial schedule before opening Stripe", async () => {
    mockSubscriptionRows([{
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      status: "trialing",
      cancelAtPeriodEnd: false,
    }]);
    const create = vi
      .fn()
      .mockResolvedValue({ url: "https://billing.stripe.com/session/switch" });
    const release = vi.fn().mockResolvedValue({ id: "sub_sched_1", status: "released" });
    const retrieve = vi.fn().mockResolvedValue({
      id: "sub_123",
      status: "trialing",
      schedule: "sub_sched_1",
      items: {
        data: [{ id: "si_seat", price: { id: "price_annual" }, quantity: 1 }],
      },
    });
    vi.mocked(getStripe).mockReturnValue({
      subscriptions: { retrieve },
      subscriptionSchedules: { release },
      billingPortal: { sessions: { create } },
    } as never);

    const res = await POST(portalRequest("monthly", "sub_sched_1"));

    expect(release).toHaveBeenCalledWith("sub_sched_1", { preserve_cancel_date: true });
    // Order is the whole point: releasing after the session is created would
    // leave the session refused and the release pointless.
    expect(release.mock.invocationCallOrder[0]).toBeLessThan(
      create.mock.invocationCallOrder[0],
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://billing.stripe.com/session/switch",
    );
    expect(vi.mocked(recordAudit).mock.calls[0][0].metadata).toMatchObject({
      released_schedule: "sub_sched_1",
    });
    expect(vi.mocked(recordAudit).mock.invocationCallOrder[0]).toBeLessThan(
      create.mock.invocationCallOrder[0],
    );
    expect(create.mock.calls[0][0].return_url).toBe(
      "https://app.foundryplanning.com/settings/billing?billing_error=plan_change_incomplete",
    );
  });

  describe("recovering a trial with an existing schedule", () => {
    const release = vi.fn();
    const create = vi.fn();
    const retrieve = vi.fn();

    beforeEach(() => {
      mockSubscriptionRows([{
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        status: "trialing",
        cancelAtPeriodEnd: false,
      }]);
      retrieve.mockResolvedValue({
        id: "sub_123",
        status: "trialing",
        schedule: { id: "sub_sched_1" },
        items: { data: [{ id: "si_seat", price: { id: "price_annual" }, quantity: 1 }] },
      });
      release.mockResolvedValue({ id: "sub_sched_1", status: "released" });
      create.mockResolvedValue({ url: "https://billing.stripe.com/session/switch" });
      vi.mocked(getStripe).mockReturnValue({
        subscriptions: { retrieve },
        subscriptionSchedules: { release },
        billingPortal: { sessions: { create } },
      } as never);
    });

    it.each([undefined, "sub_sched_outdated"])(
      "preserves the schedule until the customer confirms replacing this exact change (%s)",
      async (confirmation) => {
        const res = await POST(portalRequest("monthly", confirmation));
        const location = new URL(res.headers.get("location")!);

        expect(res.status).toBe(303);
        expect(location.searchParams.get("billing_error")).toBe("trial_change_scheduled");
        expect(location.searchParams.get("plan")).toBe("monthly");
        expect(location.searchParams.get("schedule")).toBe("sub_sched_1");
        expect(release).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
      },
    );

    it.each([
      { status: "canceled" },
      { status: "past_due" },
      { status: "trialing", cancel_at_period_end: true },
      { status: "trialing", cancel_at: 1900000000 },
    ])("checks Stripe's current state before releasing a schedule: %j", async (state) => {
      retrieve.mockResolvedValue({
        ...await retrieve(),
        ...state,
      });

      const res = await POST(portalRequest("monthly", "sub_sched_1"));

      expect(res.headers.get("location")).toContain("billing_error=plan_change_unavailable");
      expect(release).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it("preserves the schedule when preparing Stripe's configuration fails", async () => {
      vi.mocked(getPlanSwitchPortalConfigurationId).mockRejectedValueOnce(new Error("configuration failed"));

      const res = await POST(portalRequest("monthly", "sub_sched_1"));

      expect(res.headers.get("location")).toContain("billing_error=portal_unavailable");
      expect(release).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it("records the removed schedule even when opening Stripe fails afterward", async () => {
      create.mockRejectedValueOnce(new Error("session failed"));

      const res = await POST(portalRequest("monthly", "sub_sched_1"));

      expect(res.headers.get("location")).toContain("billing_error=plan_change_incomplete");
      expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: "billing.subscription_updated",
        firmId: "org_abc",
        resourceId: "sub_123",
        metadata: expect.objectContaining({ released_schedule: "sub_sched_1" }),
      }));
    });

    it("does not open Stripe when releasing the schedule fails", async () => {
      release.mockRejectedValueOnce(new Error("release failed"));

      const res = await POST(portalRequest("monthly", "sub_sched_1"));

      expect(res.headers.get("location")).toContain("billing_error=portal_unavailable");
      expect(create).not.toHaveBeenCalled();
      expect(recordAudit).not.toHaveBeenCalled();
    });
  });

  it.each(["active", "trialing"])("protects a paid schedule even if the local status is %s", async (status) => {
    mockSubscriptionRows([{
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      status,
      cancelAtPeriodEnd: false,
    }]);
    const create = vi.fn();
    const release = vi.fn();
    const retrieve = vi.fn().mockResolvedValue({
      id: "sub_123",
      status: "active",
      schedule: "sub_sched_2",
      items: {
        data: [{ id: "si_seat", price: { id: "price_annual" }, quantity: 1 }],
      },
    });
    vi.mocked(getStripe).mockReturnValue({
      subscriptions: { retrieve },
      subscriptionSchedules: { release },
      billingPortal: { sessions: { create } },
    } as never);

    const res = await POST(portalRequest("monthly", "sub_sched_2"));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://app.foundryplanning.com/settings/billing?billing_error=plan_change_scheduled",
    );
    expect(release).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
