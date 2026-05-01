import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoicesRetrieve = vi.fn();
const mockSubsRetrieve = vi.fn();
vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({
    invoices: { retrieve: (...a: unknown[]) => mockInvoicesRetrieve(...a) },
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

const mockInvoiceUpsert = vi.fn();
const mockSubUpdate = vi.fn();
const mockSubSelect = vi.fn();
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => ({ onConflictDoUpdate: () => mockInvoiceUpsert(v) }),
    }),
    update: () => ({ set: (v: unknown) => ({ where: () => mockSubUpdate(v) }) }),
    select: () => ({ from: () => ({ where: () => mockSubSelect() }) }),
  },
}));

const mockRecordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => mockRecordAudit(a) }));

import { handleInvoiceUpserted } from "../invoice-upserted";

beforeEach(() => {
  mockInvoicesRetrieve.mockReset();
  mockSubsRetrieve.mockReset();
  mockInvoiceUpsert.mockReset();
  mockSubUpdate.mockReset();
  mockSubSelect.mockReset();
  mockUpdateOrgMeta.mockReset();
  mockRecordAudit.mockReset();
});

describe("handleInvoiceUpserted", () => {
  it("upserts invoice on invoice.created", async () => {
    mockInvoicesRetrieve.mockResolvedValue({
      id: "in_1",
      customer: "cus_1",
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: "sub_1" },
      },
      status: "open",
      amount_due: 9900,
      amount_paid: 0,
      currency: "usd",
      period_start: 1700000000,
      period_end: 1702592000,
      hosted_invoice_url: null,
      invoice_pdf: null,
      status_transitions: { paid_at: null },
      metadata: { firm_id: "org_1" },
    });
    await handleInvoiceUpserted({
      id: "evt_inv",
      type: "invoice.created",
      data: { object: { id: "in_1" } },
    } as never);
    expect(mockInvoiceUpsert).toHaveBeenCalled();
  });

  it("on invoice.paid recovery, flips parent sub from past_due to active", async () => {
    mockInvoicesRetrieve.mockResolvedValue({
      id: "in_2",
      customer: "cus_1",
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: "sub_1" },
      },
      status: "paid",
      amount_due: 9900,
      amount_paid: 9900,
      currency: "usd",
      period_start: 1700000000,
      period_end: 1702592000,
      hosted_invoice_url: null,
      invoice_pdf: null,
      status_transitions: { paid_at: 1700000000 },
      metadata: { firm_id: "org_1" },
    });
    mockSubSelect.mockResolvedValue([
      { status: "past_due", stripeSubscriptionId: "sub_1" },
    ]);
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_1",
      status: "active",
      metadata: { firm_id: "org_1" },
    });
    await handleInvoiceUpserted({
      id: "evt_paid",
      type: "invoice.paid",
      data: { object: { id: "in_2" } },
    } as never);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "billing.payment_recovered" }),
    );
  });
});
