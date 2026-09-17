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
// The firms row the handler reads to decide whether this cancellation is
// churn (archive it) or a comp (leave it alone).
const h = vi.hoisted(() => ({ firmRow: { isFounder: false } as { isFounder: boolean } }));
vi.mock("@/db", () => ({
  db: {
    update: (table: unknown) => ({
      set: (v: unknown) => ({
        where: () =>
          table === "subscriptions" ? mockSubUpdate(v) : mockFirmUpdate(v),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([h.firmRow]) }),
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
  h.firmRow = { isFounder: false };
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

describe("handleSubscriptionDeleted — a founder's cancellation is a comp, not churn", () => {
  const founderEvent = {
    id: "evt_del_founder",
    type: "customer.subscription.deleted",
    data: { object: { id: "sub_f" } },
  } as never;

  beforeEach(() => {
    h.firmRow = { isFounder: true };
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_f",
      status: "canceled",
      canceled_at: 1700000000,
      metadata: { firm_id: "org_founder" },
    });
  });

  it("does NOT archive the firm — archiving would hand it to the purge cron", async () => {
    await handleSubscriptionDeleted(founderEvent);
    // The subscription row is still marked canceled; only the firm is spared.
    expect(mockSubUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "canceled" }),
    );
    expect(mockFirmUpdate).not.toHaveBeenCalled();
  });

  it("keeps Clerk on the founder status with no cancellation shadow", async () => {
    await handleSubscriptionDeleted(founderEvent);
    expect(mockUpdateOrgMeta).toHaveBeenCalledWith(
      "org_founder",
      expect.objectContaining({
        publicMetadata: { subscription_status: "founder", archived_at: null },
      }),
    );
  });

  it("records why the archive was skipped", async () => {
    await handleSubscriptionDeleted(founderEvent);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "billing.canceled",
        metadata: expect.objectContaining({ founder: true }),
      }),
    );
  });

  it("control: the identical event DOES archive a non-founder firm", async () => {
    h.firmRow = { isFounder: false };
    await handleSubscriptionDeleted(founderEvent);
    expect(mockFirmUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ archivedAt: expect.any(Date) }),
    );
  });
});
