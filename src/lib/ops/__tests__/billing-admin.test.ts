import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  subRows: [] as Array<Record<string, unknown>>,
  portalCreate: vi.fn(),
  subUpdate: vi.fn(),
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/db/schema", () => ({
  subscriptions: { __t: "subscriptions" },
  invoices: { __t: "invoices" },
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (t: { __t: string }) => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(t.__t === "subscriptions" ? h.subRows : []),
            then: (r: (v: unknown[]) => unknown) => r(t.__t === "subscriptions" ? h.subRows : []),
          }),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({
    billingPortal: { sessions: { create: (...a: unknown[]) => h.portalCreate(...a) } },
    subscriptions: { update: (...a: unknown[]) => h.subUpdate(...a) },
  }),
}));

vi.mock("@/lib/audit", () => ({
  recordAudit: (a: Record<string, unknown>) => {
    h.audits.push(a);
    return Promise.resolve();
  },
}));

import {
  stripeDashboardCustomerUrl,
  computeExtendedTrialEnd,
  createPortalSessionForFirm,
  extendTrialForFirm,
} from "../billing-admin";

beforeEach(() => {
  h.subRows = [];
  h.portalCreate.mockReset().mockResolvedValue({ url: "https://billing.stripe.test/session" });
  h.subUpdate.mockReset().mockResolvedValue({});
  h.audits = [];
});

describe("stripeDashboardCustomerUrl", () => {
  it("uses the live path for live mode", () => {
    expect(stripeDashboardCustomerUrl("cus_1", true)).toBe("https://dashboard.stripe.com/customers/cus_1");
  });
  it("uses the test/ path for test mode", () => {
    expect(stripeDashboardCustomerUrl("cus_1", false)).toBe("https://dashboard.stripe.com/test/customers/cus_1");
  });
});

describe("computeExtendedTrialEnd", () => {
  const now = new Date("2026-06-16T00:00:00Z");
  it("extends from a future current trial end", () => {
    const cur = new Date("2026-06-20T00:00:00Z");
    expect(computeExtendedTrialEnd(cur, 7, now).toISOString()).toBe("2026-06-27T00:00:00.000Z");
  });
  it("extends from now when the trial already lapsed", () => {
    const cur = new Date("2026-06-10T00:00:00Z");
    expect(computeExtendedTrialEnd(cur, 7, now).toISOString()).toBe("2026-06-23T00:00:00.000Z");
  });
  it("extends from now when there is no current trial end", () => {
    expect(computeExtendedTrialEnd(null, 14, now).toISOString()).toBe("2026-06-30T00:00:00.000Z");
  });
});

describe("createPortalSessionForFirm", () => {
  it("creates a session against the firm's customer and audits portal_opened", async () => {
    h.subRows = [{ stripeCustomerId: "cus_42" }];
    const url = await createPortalSessionForFirm({ firmId: "org_1", returnUrl: "https://app/admin", setBy: "user_op" });
    expect(url).toBe("https://billing.stripe.test/session");
    expect(h.portalCreate).toHaveBeenCalledWith({ customer: "cus_42", return_url: "https://app/admin" });
    expect(h.audits[0]).toMatchObject({ action: "ops.billing.portal_opened", actorId: "user_op", firmId: "org_1", resourceId: "cus_42" });
  });
  it("throws when the firm has no Stripe customer", async () => {
    h.subRows = [];
    await expect(
      createPortalSessionForFirm({ firmId: "org_1", returnUrl: "x", setBy: "user_op" }),
    ).rejects.toThrow(/no Stripe customer/i);
  });
});

describe("extendTrialForFirm", () => {
  it("updates the live trialing sub and audits trial_extended", async () => {
    h.subRows = [
      { status: "trialing", stripeSubscriptionId: "sub_1", trialEnd: new Date("2026-06-20T00:00:00Z") },
    ];
    const end = await extendTrialForFirm({ firmId: "org_1", days: 7, reason: "support", setBy: "user_op" });
    expect(end.toISOString()).toBe("2026-06-27T00:00:00.000Z");
    expect(h.subUpdate).toHaveBeenCalledWith("sub_1", {
      trial_end: Math.floor(new Date("2026-06-27T00:00:00Z").getTime() / 1000),
      proration_behavior: "none",
    });
    expect(h.audits[0]).toMatchObject({ action: "ops.billing.trial_extended", actorId: "user_op", firmId: "org_1" });
  });
  it("rejects a non-trialing subscription", async () => {
    h.subRows = [{ status: "active", stripeSubscriptionId: "sub_1", trialEnd: null }];
    await expect(
      extendTrialForFirm({ firmId: "org_1", days: 7, reason: "x", setBy: "user_op" }),
    ).rejects.toThrow(/trialing/i);
  });
  it("rejects an out-of-range day count", async () => {
    h.subRows = [{ status: "trialing", stripeSubscriptionId: "sub_1", trialEnd: null }];
    await expect(
      extendTrialForFirm({ firmId: "org_1", days: 0, reason: "x", setBy: "user_op" }),
    ).rejects.toThrow(/1.?90 days/i);
  });
});
