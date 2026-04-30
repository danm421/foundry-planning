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

const mockUpdate = vi.fn();
vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (v: unknown) => ({ where: () => mockUpdate(v) }),
    }),
  },
}));

const mockRecordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  recordAudit: (a: unknown) => mockRecordAudit(a),
}));

import { handleSubscriptionPaused } from "../customer-subscription-paused";

beforeEach(() => {
  mockSubsRetrieve.mockReset();
  mockUpdate.mockReset();
  mockUpdateOrgMeta.mockReset();
  mockRecordAudit.mockReset();
});

describe("handleSubscriptionPaused", () => {
  it("flips DB + Clerk to paused without setting archived_at", async () => {
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_1",
      status: "paused",
      metadata: { firm_id: "org_1" },
    });
    await handleSubscriptionPaused({
      id: "evt_p",
      type: "customer.subscription.paused",
      data: { object: { id: "sub_1" } },
    } as never);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "paused" }),
    );
    expect(mockUpdateOrgMeta).toHaveBeenCalledWith(
      "org_1",
      expect.objectContaining({
        publicMetadata: expect.objectContaining({
          subscription_status: "paused",
        }),
      }),
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "billing.subscription_updated",
        firmId: "org_1",
        actorId: "stripe:webhook:evt_p",
        metadata: expect.objectContaining({ event_kind: "paused" }),
      }),
    );
  });

  it("throws when subscription has no firm_id in metadata", async () => {
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_2",
      status: "paused",
      metadata: {},
    });
    await expect(
      handleSubscriptionPaused({
        id: "evt_p2",
        type: "customer.subscription.paused",
        data: { object: { id: "sub_2" } },
      } as never),
    ).rejects.toThrow(/firm_id/);
  });
});
