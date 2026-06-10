// src/lib/billing/__tests__/purge-firm.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  selectHouseholds: vi.fn(),
  purgeHousehold: vi.fn(),
  deleteSubs: vi.fn(),
  deleteInvoices: vi.fn(),
  updateFirm: vi.fn(),
  selectCustomer: vi.fn(),
  stripeCustomersDel: vi.fn(),
  clerkDeleteOrg: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@/db", async () => {
  const schema = (await import("@/db/schema")) as Record<string, unknown>;
  return {
    db: {
      select: () => ({
        from: (tbl: unknown) => ({
          where: () => {
            if (tbl === schema.crmHouseholds) return mocks.selectHouseholds();
            if (tbl === schema.subscriptions) return mocks.selectCustomer();
            return [];
          },
        }),
      }),
      delete: (tbl: unknown) => ({
        where: () => {
          const s = schema as Record<string, unknown>;
          if (tbl === s.subscriptions) return mocks.deleteSubs();
          if (tbl === s.invoices) return mocks.deleteInvoices();
          return undefined;
        },
      }),
      update: () => ({ set: (v: unknown) => ({ where: () => mocks.updateFirm(v) }) }),
    },
  };
});
vi.mock("@/lib/crm/households", () => ({ purgeCrmHouseholdById: mocks.purgeHousehold }));
vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({ customers: { del: mocks.stripeCustomersDel } }),
}));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({ organizations: { deleteOrganization: mocks.clerkDeleteOrg } }),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));

import { purgeFirmById } from "../purge-firm";

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.selectHouseholds.mockResolvedValue([{ id: "h1" }, { id: "h2" }]);
  mocks.purgeHousehold.mockResolvedValue(undefined);
  mocks.selectCustomer.mockResolvedValue([{ stripeCustomerId: "cus_1" }]);
  mocks.stripeCustomersDel.mockResolvedValue({ id: "cus_1", deleted: true });
  mocks.clerkDeleteOrg.mockResolvedValue(undefined);
});

describe("purgeFirmById", () => {
  it("cascades PII, deletes the Stripe customer + Clerk org, stamps purgedAt, audits", async () => {
    await purgeFirmById("org_1");

    // every household for the firm is force-purged (firm-agnostic deletePII path)
    expect(mocks.purgeHousehold).toHaveBeenCalledWith("h1", "org_1", true);
    expect(mocks.purgeHousehold).toHaveBeenCalledWith("h2", "org_1", true);
    // billing rows dropped
    expect(mocks.deleteInvoices).toHaveBeenCalledTimes(1);
    expect(mocks.deleteSubs).toHaveBeenCalledTimes(1);
    // external systems
    expect(mocks.stripeCustomersDel).toHaveBeenCalledWith("cus_1");
    expect(mocks.clerkDeleteOrg).toHaveBeenCalledWith("org_1");
    // purgedAt stamped on the firms row (kept for the purge record)
    expect(mocks.updateFirm).toHaveBeenCalledWith(
      expect.objectContaining({ purgedAt: expect.any(Date) }),
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "firm.purged", firmId: "org_1" }),
    );
  });

  it("still stamps + audits when the firm has no Stripe customer", async () => {
    mocks.selectCustomer.mockResolvedValue([]);
    await purgeFirmById("org_2");
    expect(mocks.stripeCustomersDel).not.toHaveBeenCalled();
    expect(mocks.updateFirm).toHaveBeenCalledWith(
      expect.objectContaining({ purgedAt: expect.any(Date) }),
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "firm.purged", firmId: "org_2" }),
    );
  });

  it("swallows a Stripe customer-delete failure and still completes the purge", async () => {
    mocks.stripeCustomersDel.mockRejectedValueOnce(new Error("already deleted"));
    await expect(purgeFirmById("org_3")).resolves.toBeUndefined();
    expect(mocks.clerkDeleteOrg).toHaveBeenCalledWith("org_3");
    expect(mocks.updateFirm).toHaveBeenCalled();
  });
});
