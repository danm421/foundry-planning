import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSubsRetrieve = vi.fn();
vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({
    subscriptions: { retrieve: (...a: unknown[]) => mockSubsRetrieve(...a) },
  }),
}));

const mockUpdateOrgMeta = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    organizations: {
      updateOrganizationMetadata: (...a: unknown[]) => mockUpdateOrgMeta(...a),
    },
  }),
}));

const mockSelectFirms = vi.fn();
const mockSelectActiveSub = vi.fn();
const mockSubsUpsert = vi.fn();
const mockItemsUpsert = vi.fn();
vi.mock("@/db", async (orig) => {
  const schema = (await import("@/db/schema")) as Record<string, unknown>;
  return {
    ...((await orig()) as object),
    db: {
      select: () => ({
        from: (tbl: unknown) => ({
          where: () => {
            if (tbl === schema.firms) return mockSelectFirms();
            if (tbl === schema.subscriptions) return mockSelectActiveSub();
            return [];
          },
        }),
      }),
      insert: () => ({
        values: (v: unknown) => ({
          onConflictDoUpdate: () => ({
            returning: () =>
              Array.isArray(v) ? mockItemsUpsert(v) : mockSubsUpsert(v),
          }),
        }),
      }),
    },
  };
});

const mockCaptureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...a: unknown[]) => mockCaptureMessage(...a),
}));

const mockRecordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  recordAudit: (a: unknown) => mockRecordAudit(a),
}));

// Override-aware write paths now consult manual entitlement overrides. These are
// the non-override flow tests, so stub the lookup to "no active overrides" —
// preserving the original assertions (entitlements derived from sub items alone).
vi.mock("@/lib/ops/entitlements", () => ({
  getActiveEntitlementOverrides: () => Promise.resolve([]),
}));

import { handleSubscriptionUpsert } from "../customer-subscription-upserted";

beforeEach(() => {
  mockSubsRetrieve.mockReset();
  mockUpdateOrgMeta.mockReset();
  mockSelectFirms.mockReset();
  mockSubsUpsert.mockReset();
  mockItemsUpsert.mockReset();
  mockRecordAudit.mockReset();
  mockSelectActiveSub.mockReset();
  mockSelectActiveSub.mockResolvedValue([]); // default: no conflicting active sub
  mockCaptureMessage.mockReset();
});

describe("handleSubscriptionUpsert", () => {
  it("re-fetches the live subscription, upserts DB rows, syncs Clerk metadata, audits", async () => {
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      cancel_at_period_end: false,
      canceled_at: null,
      trial_start: null,
      trial_end: null,
      metadata: { firm_id: "org_1" },
      items: {
        data: [
          {
            id: "si_seat",
            price: { id: "price_seat", unit_amount: 9900, currency: "usd" },
            quantity: 3,
            metadata: { kind: "seat" },
            current_period_start: 1700000000,
            current_period_end: 1702592000,
          },
        ],
      },
    });
    mockSelectFirms.mockResolvedValue([{ firmId: "org_1", isFounder: false }]);
    mockSubsUpsert.mockResolvedValue([{ id: "internal-sub-uuid" }]);
    mockItemsUpsert.mockResolvedValue([]);

    await handleSubscriptionUpsert({
      id: "evt_1",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1" } },
    } as never);

    expect(mockSubsRetrieve).toHaveBeenCalledWith("sub_1", {
      expand: ["items.data.price"],
    });
    expect(mockSubsUpsert).toHaveBeenCalledTimes(1);
    expect(mockItemsUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpdateOrgMeta).toHaveBeenCalledWith(
      "org_1",
      expect.objectContaining({
        publicMetadata: expect.objectContaining({
          subscription_status: "active",
          stripe_customer_id: "cus_1",
          stripe_subscription_id: "sub_1",
        }),
      }),
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "billing.subscription_updated",
        firmId: "org_1",
        actorId: "stripe:webhook:evt_1",
      }),
    );
  });

  it("grants the seat-bundled ai_import entitlement and mirrors add-on taxonomy to the DB", async () => {
    // Any active seat grants ai_import (bundled into the plan). A generic
    // add-on line still maps to the DB mirror via price.metadata so reconcile
    // can read it. kind/addon_key live on price.metadata; the item metadata is
    // intentionally empty.
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_ai",
      customer: "cus_ai",
      status: "active",
      cancel_at_period_end: false,
      canceled_at: null,
      trial_start: null,
      trial_end: null,
      metadata: { firm_id: "org_ai" },
      items: {
        data: [
          {
            id: "si_seat",
            price: {
              id: "price_seat",
              unit_amount: 9900,
              currency: "usd",
              metadata: { kind: "seat" },
            },
            quantity: 1,
            metadata: {},
            current_period_start: 1700000000,
            current_period_end: 1702592000,
          },
          {
            id: "si_addon",
            price: {
              id: "price_white_label",
              unit_amount: 19900,
              currency: "usd",
              metadata: { kind: "addon", addon_key: "white_label" },
            },
            quantity: 1,
            metadata: {},
          },
        ],
      },
    });
    mockSelectFirms.mockResolvedValue([{ firmId: "org_ai", isFounder: false }]);
    mockSubsUpsert.mockResolvedValue([{ id: "internal-sub-ai" }]);
    mockItemsUpsert.mockResolvedValue([]);

    await handleSubscriptionUpsert({
      id: "evt_ai",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_ai" } },
    } as never);

    expect(mockUpdateOrgMeta).toHaveBeenCalledWith(
      "org_ai",
      expect.objectContaining({
        publicMetadata: expect.objectContaining({
          entitlements: ["ai_import", "white_label"],
        }),
      }),
    );
    const itemRows = mockItemsUpsert.mock.calls[0][0] as Array<{
      stripePriceId: string;
      kind: string;
      addonKey: string | null;
    }>;
    expect(itemRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stripePriceId: "price_white_label",
          kind: "addon",
          addonKey: "white_label",
        }),
      ]),
    );
  });

  it("emits billing.subscription_created on the .created event type", async () => {
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_3",
      customer: "cus_3",
      status: "trialing",
      cancel_at_period_end: false,
      canceled_at: null,
      trial_start: 1700000000,
      trial_end: 1702592000,
      metadata: { firm_id: "org_3" },
      items: { data: [] },
    });
    mockSelectFirms.mockResolvedValue([{ firmId: "org_3", isFounder: false }]);
    mockSubsUpsert.mockResolvedValue([{ id: "internal-sub-3" }]);
    mockItemsUpsert.mockResolvedValue([]);

    await handleSubscriptionUpsert({
      id: "evt_3",
      type: "customer.subscription.created",
      data: { object: { id: "sub_3" } },
    } as never);

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "billing.subscription_created" }),
    );
  });

  it("no-ops when subscription has no firm_id in metadata (race: checkout.session.completed not yet run)", async () => {
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_2",
      customer: "cus_2",
      status: "active",
      metadata: {},
      items: { data: [] },
    });

    await handleSubscriptionUpsert({
      id: "evt_2",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_2" } },
    } as never);

    expect(mockSelectFirms).not.toHaveBeenCalled();
    expect(mockSubsUpsert).not.toHaveBeenCalled();
    expect(mockUpdateOrgMeta).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("no-ops when firm_id is set on the sub but firms row hasn't been committed yet (FK race)", async () => {
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_3",
      customer: "cus_3",
      status: "trialing",
      metadata: { firm_id: "org_3" },
      items: { data: [] },
    });
    mockSelectFirms.mockResolvedValue([]); // firms row not yet committed

    await handleSubscriptionUpsert({
      id: "evt_3",
      type: "customer.subscription.created",
      data: { object: { id: "sub_3" } },
    } as never);

    expect(mockSelectFirms).toHaveBeenCalledTimes(1);
    expect(mockSubsUpsert).not.toHaveBeenCalled();
    expect(mockUpdateOrgMeta).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("skips + Sentry-pages when the firm already has a different active subscription", async () => {
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_new",
      customer: "cus_1",
      status: "active",
      cancel_at_period_end: false,
      canceled_at: null,
      trial_start: null,
      trial_end: null,
      metadata: { firm_id: "org_1" },
      items: { data: [] },
    });
    mockSelectFirms.mockResolvedValue([{ firmId: "org_1", isFounder: false }]);
    // An existing active row for the firm with a DIFFERENT stripe sub id.
    mockSelectActiveSub.mockResolvedValue([
      { stripeSubscriptionId: "sub_old", status: "active" },
    ]);

    await handleSubscriptionUpsert({
      id: "evt_dbl",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_new" } },
    } as never);

    expect(mockCaptureMessage).toHaveBeenCalled();
    expect(mockSubsUpsert).not.toHaveBeenCalled();
    expect(mockUpdateOrgMeta).not.toHaveBeenCalled();
  });

  it("upserts normally when the only other subscription is canceled (cancel-then-resubscribe)", async () => {
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_new",
      customer: "cus_1",
      status: "active",
      cancel_at_period_end: false,
      canceled_at: null,
      trial_start: null,
      trial_end: null,
      metadata: { firm_id: "org_1" },
      items: { data: [] },
    });
    mockSelectFirms.mockResolvedValue([{ firmId: "org_1", isFounder: false }]);
    // The firm's previous subscription is CANCELED — not a live conflict, so the
    // partial unique index would not throw and the new sub must upsert.
    mockSelectActiveSub.mockResolvedValue([
      { stripeSubscriptionId: "sub_old", status: "canceled" },
    ]);
    mockSubsUpsert.mockResolvedValue([{ id: "internal-sub-uuid" }]);
    mockItemsUpsert.mockResolvedValue([]);

    await handleSubscriptionUpsert({
      id: "evt_resub",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_new" } },
    } as never);

    expect(mockCaptureMessage).not.toHaveBeenCalled();
    expect(mockSubsUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpdateOrgMeta).toHaveBeenCalled();
  });
});
