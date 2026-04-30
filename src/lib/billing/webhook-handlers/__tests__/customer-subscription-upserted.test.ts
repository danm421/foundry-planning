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
const mockSubsUpsert = vi.fn();
const mockItemsUpsert = vi.fn();
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => mockSelectFirms() }) }),
    insert: () => ({
      values: (v: unknown) => ({
        onConflictDoUpdate: () => ({
          returning: () =>
            Array.isArray(v) ? mockItemsUpsert(v) : mockSubsUpsert(v),
        }),
      }),
    }),
  },
}));

const mockRecordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  recordAudit: (a: unknown) => mockRecordAudit(a),
}));

import { handleSubscriptionUpsert } from "../customer-subscription-upserted";

beforeEach(() => {
  mockSubsRetrieve.mockReset();
  mockUpdateOrgMeta.mockReset();
  mockSelectFirms.mockReset();
  mockSubsUpsert.mockReset();
  mockItemsUpsert.mockReset();
  mockRecordAudit.mockReset();
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

  it("throws when subscription has no firm_id in metadata", async () => {
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_2",
      customer: "cus_2",
      status: "active",
      metadata: {},
      items: { data: [] },
    });
    await expect(
      handleSubscriptionUpsert({
        id: "evt_2",
        type: "customer.subscription.updated",
        data: { object: { id: "sub_2" } },
      } as never),
    ).rejects.toThrow(/firm_id/);
  });
});
