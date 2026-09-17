import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  subRows: [] as Array<Record<string, unknown>>,
  portalCreate: vi.fn(),
  subUpdate: vi.fn(),
  subCancel: vi.fn(),
  applyFounder: vi.fn(),
  billingContact: vi.fn(),
  orgMeta: {} as Record<string, unknown>,
  orgName: "Acme Wealth",
  updateOrgMeta: vi.fn(),
  audits: [] as Array<Record<string, unknown>>,
  /** Ordered log of the writes whose sequence is load-bearing. */
  calls: [] as string[],
  firmUpdates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/db/schema", () => ({
  subscriptions: { __t: "subscriptions" },
  invoices: { __t: "invoices" },
  firms: { __t: "firms" },
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
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          h.calls.push("firms.update");
          h.firmUpdates.push(v);
          return Promise.resolve();
        },
      }),
    }),
  },
}));

vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({
    billingPortal: { sessions: { create: (...a: unknown[]) => h.portalCreate(...a) } },
    subscriptions: {
      update: (...a: unknown[]) => h.subUpdate(...a),
      cancel: (...a: unknown[]) => {
        h.calls.push("stripe.cancel");
        return h.subCancel(...a);
      },
    },
  }),
}));

vi.mock("@/lib/billing/founder-init", () => ({
  applyFounderState: (...a: unknown[]) => {
    h.calls.push("applyFounderState");
    return h.applyFounder(...a);
  },
}));

vi.mock("@/lib/billing/billing-contact", () => ({
  resolveBillingContactUserId: (...a: unknown[]) => h.billingContact(...a),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    organizations: {
      getOrganization: async () => ({ name: h.orgName, publicMetadata: h.orgMeta }),
      updateOrganizationMetadata: (...a: unknown[]) => {
        h.calls.push("clerk.updateOrgMeta");
        return h.updateOrgMeta(...a);
      },
    },
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
  compFirmToFounder,
  endFounderComp,
} from "../billing-admin";

beforeEach(() => {
  h.subRows = [];
  h.portalCreate.mockReset().mockResolvedValue({ url: "https://billing.stripe.test/session" });
  h.subUpdate.mockReset().mockResolvedValue({});
  h.subCancel.mockReset().mockResolvedValue({});
  h.applyFounder.mockReset().mockResolvedValue(undefined);
  h.billingContact.mockReset().mockResolvedValue("user_owner");
  h.updateOrgMeta.mockReset().mockResolvedValue(undefined);
  h.orgMeta = {};
  h.orgName = "Acme Wealth";
  h.audits = [];
  h.calls = [];
  h.firmUpdates = [];
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
    // The extension runs from the later of the current trial end or now, so the
    // clock is frozen before the fixture's end date — otherwise this asserts the
    // "already expired" branch the moment that date slips into the past.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T00:00:00Z"));
    h.subRows = [
      { status: "trialing", stripeSubscriptionId: "sub_1", trialEnd: new Date("2026-06-20T00:00:00Z") },
    ];
    const end = await extendTrialForFirm({ firmId: "org_1", days: 7, reason: "support", setBy: "user_op" });
    vi.useRealTimers();
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

describe("compFirmToFounder", () => {
  const live = { status: "trialing", stripeSubscriptionId: "sub_live", stripeCustomerId: "cus_1" };

  it("sets founder state BEFORE cancelling in Stripe", async () => {
    // The ordering is the whole safety property. The deleted-subscription
    // webhook decides whether to archive the firm by reading firms.is_founder,
    // which applyFounderState writes — so cancelling first would archive a
    // customer we just comped and start the purge clock on their data.
    h.subRows = [live];
    await compFirmToFounder({ firmId: "org_1", reason: "design partner", setBy: "user_op" });
    expect(h.calls).toEqual(["applyFounderState", "firms.update", "stripe.cancel"]);
  });

  it("cancels the live subscription without proration", async () => {
    h.subRows = [live];
    const res = await compFirmToFounder({ firmId: "org_1", reason: "design partner", setBy: "user_op" });
    expect(h.subCancel).toHaveBeenCalledWith("sub_live", { prorate: false });
    expect(res.canceledSubscriptionId).toBe("sub_live");
  });

  it("comps a firm that never subscribed, cancelling nothing", async () => {
    h.subRows = [];
    const res = await compFirmToFounder({ firmId: "org_1", reason: "beta", setBy: "user_op" });
    expect(h.subCancel).not.toHaveBeenCalled();
    expect(res.canceledSubscriptionId).toBeNull();
    expect(h.calls).toEqual(["applyFounderState", "firms.update"]);
  });

  it("leaves a canceled-only firm's dead subscription alone", async () => {
    h.subRows = [{ status: "canceled", stripeSubscriptionId: "sub_dead" }];
    const res = await compFirmToFounder({ firmId: "org_1", reason: "winback", setBy: "user_op" });
    expect(h.subCancel).not.toHaveBeenCalled();
    expect(res.canceledSubscriptionId).toBeNull();
  });

  it("carries existing entitlements forward so a grant isn't silently stripped", async () => {
    // client_portal is not in the base set and no Stripe price implies it, so
    // deriving from scratch would drop it from a firm that had been granted it.
    h.subRows = [live];
    h.orgMeta = { entitlements: ["ai_import", "client_portal"] };
    await compFirmToFounder({ firmId: "org_1", reason: "design partner", setBy: "user_op" });
    expect(h.applyFounder).toHaveBeenCalledWith(
      expect.objectContaining({
        firmId: "org_1",
        ownerUserId: "user_owner",
        entitlements: ["ai_import", "client_portal"],
      }),
    );
  });

  it("resolves the owner through the billing contact chain", async () => {
    h.subRows = [live];
    h.billingContact.mockResolvedValue("user_pinned");
    await compFirmToFounder({ firmId: "org_1", reason: "x", setBy: "user_op" });
    expect(h.applyFounder).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "user_pinned" }),
    );
  });

  it("refuses a member-less org rather than guessing an owner", async () => {
    h.billingContact.mockResolvedValue(null);
    await expect(
      compFirmToFounder({ firmId: "org_1", reason: "x", setBy: "user_op" }),
    ).rejects.toThrow(/no members/i);
    expect(h.calls).toEqual([]);
  });

  it("requires a reason, and writes nothing without one", async () => {
    h.subRows = [live];
    await expect(
      compFirmToFounder({ firmId: "org_1", reason: "   ", setBy: "user_op" }),
    ).rejects.toThrow(/reason is required/i);
    expect(h.calls).toEqual([]);
    expect(h.audits).toEqual([]);
  });

  it("audits the comp with the reason and what was cancelled", async () => {
    h.subRows = [live];
    await compFirmToFounder({ firmId: "org_1", reason: "design partner", setBy: "user_op" });
    expect(h.audits[0]).toMatchObject({
      action: "ops.billing.comped_to_founder",
      firmId: "org_1",
      actorId: "user_op",
      metadata: expect.objectContaining({
        reason: "design partner",
        canceledSubscriptionId: "sub_live",
        previousStatus: "trialing",
      }),
    });
  });
});

describe("compFirmToFounder — comping a firm that already churned", () => {
  // The case with no live subscription to cancel. Nothing calls Stripe, so the
  // deleted-subscription webhook never fires, so the branch that spares a
  // founder from being archived never runs — the archive stamp and its 90-day
  // deletion clock are still sitting on the row from the original cancellation.
  it("lifts the archive stamp and the deletion clock", async () => {
    h.subRows = [{ status: "canceled", stripeSubscriptionId: "sub_dead" }];
    await compFirmToFounder({ firmId: "org_1", reason: "winback", setBy: "user_op" });
    expect(h.subCancel).not.toHaveBeenCalled();
    expect(h.firmUpdates).toHaveLength(1);
    expect(h.firmUpdates[0]).toMatchObject({ archivedAt: null, dataRetentionUntil: null });
  });

  it("clears the stamp before cancelling, so the webhook can't re-stamp it", async () => {
    h.subRows = [{ status: "trialing", stripeSubscriptionId: "sub_live" }];
    await compFirmToFounder({ firmId: "org_1", reason: "design partner", setBy: "user_op" });
    expect(h.calls.indexOf("firms.update")).toBeLessThan(h.calls.indexOf("stripe.cancel"));
  });

  it("writes nothing when the reason is missing", async () => {
    await expect(
      compFirmToFounder({ firmId: "org_1", reason: "", setBy: "user_op" }),
    ).rejects.toThrow(/reason is required/i);
    expect(h.firmUpdates).toEqual([]);
  });
});

describe("endFounderComp", () => {
  const FIRM = "org_3GunIfnXQ7DQRQsfjlrha36CgDh";
  const args = { firmId: FIRM, reason: "moving to paid", setBy: "user_ops" };

  beforeEach(() => {
    h.orgMeta = {
      is_founder: true,
      subscription_status: "founder",
      entitlements: ["ai_import", "forge", "client_portal"],
      billing_contact_userId: "user_owner",
    };
  });

  it("requires a reason", async () => {
    await expect(endFounderComp({ ...args, reason: "  " })).rejects.toThrow(/reason/i);
  });

  it("refuses a firm that is not comped — there is no comp to end", async () => {
    h.orgMeta = { subscription_status: "active" };
    await expect(endFounderComp(args)).rejects.toThrow(/not.*founder|not comped/i);
  });

  it("clears firms.is_founder", async () => {
    await endFounderComp(args);
    expect(h.firmUpdates).toContainEqual(expect.objectContaining({ isFounder: false }));
  });

  it("stamps comp_ended in Clerk and clears is_founder there too", async () => {
    await endFounderComp(args);
    expect(h.updateOrgMeta).toHaveBeenCalledWith(
      FIRM,
      expect.objectContaining({
        publicMetadata: expect.objectContaining({
          is_founder: false,
          subscription_status: "comp_ended",
        }),
      }),
    );
  });

  it("carries entitlements forward — read-only access still has to render", async () => {
    await endFounderComp(args);
    const meta = h.updateOrgMeta.mock.calls[0][1] as {
      publicMetadata: { entitlements: string[] };
    };
    expect(meta.publicMetadata.entitlements).toEqual([
      "ai_import",
      "forge",
      "client_portal",
    ]);
  });

  it("never archives the firm — that would start the 90-day deletion clock", async () => {
    await endFounderComp(args);
    // isFirmPurgeable requires archivedAt !== null, so leaving it null is what
    // keeps a de-comped firm's data out of the purge cron's reach while they
    // decide whether to subscribe.
    for (const u of h.firmUpdates) {
      expect(u).not.toHaveProperty("archivedAt", expect.anything());
      expect(u.dataRetentionUntil).toBeUndefined();
    }
    const meta = h.updateOrgMeta.mock.calls[0][1] as {
      publicMetadata: Record<string, unknown>;
    };
    expect(meta.publicMetadata.archived_at).toBeUndefined();
  });

  it("writes the DB flag BEFORE flipping Clerk", async () => {
    await endFounderComp(args);
    // Clerk is enforcement truth, so it commits last. The half-done state that
    // order leaves (DB says not-comped, Clerk still says founder) is the safe
    // one: the firm keeps access and nothing is purgeable, because
    // isFirmPurgeable also demands an archive stamp that is never set here.
    expect(h.calls.indexOf("firms.update")).toBeLessThan(
      h.calls.indexOf("clerk.updateOrgMeta"),
    );
  });

  it("audits with the reason", async () => {
    await endFounderComp(args);
    expect(h.audits).toContainEqual(
      expect.objectContaining({
        action: "ops.billing.comp_ended",
        firmId: FIRM,
        actorId: "user_ops",
        metadata: expect.objectContaining({ reason: "moving to paid" }),
      }),
    );
  });

  it("cancels nothing in Stripe — a comped firm has no subscription to cancel", async () => {
    await endFounderComp(args);
    expect(h.subCancel).not.toHaveBeenCalled();
  });
});
