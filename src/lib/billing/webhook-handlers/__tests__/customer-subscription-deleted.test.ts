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

const mockSubUpdate = vi.fn();
const mockFirmUpdate = vi.fn();
vi.mock("@/db", () => ({
  db: {
    update: (table: unknown) => ({
      set: (v: unknown) => ({
        where: () =>
          table === "subscriptions" ? mockSubUpdate(v) : mockFirmUpdate(v),
      }),
    }),
  },
}));
vi.mock("@/db/schema", async () => {
  const actual = await vi.importActual<typeof import("@/db/schema")>(
    "@/db/schema",
  );
  return { ...actual, subscriptions: "subscriptions", firms: "firms" };
});

const mockRecordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  recordAudit: (a: unknown) => mockRecordAudit(a),
}));

import { handleSubscriptionDeleted } from "../customer-subscription-deleted";

beforeEach(() => {
  mockSubsRetrieve.mockReset();
  mockUpdateOrgMeta.mockReset();
  mockSubUpdate.mockReset();
  mockFirmUpdate.mockReset();
  mockRecordAudit.mockReset();
});

describe("handleSubscriptionDeleted", () => {
  it("flips status to canceled, archives firm, audits", async () => {
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_1",
      status: "canceled",
      canceled_at: 1700000000,
      metadata: { firm_id: "org_1" },
    });
    await handleSubscriptionDeleted({
      id: "evt_del",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1" } },
    } as never);
    expect(mockSubUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "canceled" }),
    );
    expect(mockFirmUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        archivedAt: expect.any(Date),
        dataRetentionUntil: expect.any(Date),
      }),
    );
    expect(mockUpdateOrgMeta).toHaveBeenCalledWith(
      "org_1",
      expect.objectContaining({
        publicMetadata: expect.objectContaining({
          subscription_status: "canceled",
        }),
      }),
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "billing.canceled",
        firmId: "org_1",
        actorId: "stripe:webhook:evt_del",
      }),
    );
  });
});
