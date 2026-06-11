import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoicesRetrieve = vi.fn();
vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({ invoices: { retrieve: (...a: unknown[]) => mockInvoicesRetrieve(...a) } }),
}));

const mockUpdateOrgMeta = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    organizations: {
      updateOrganizationMetadata: (...a: unknown[]) => mockUpdateOrgMeta(...a),
    },
  }),
}));

vi.mock("@/lib/billing/billing-contact", () => ({
  resolveBillingContact: vi.fn().mockResolvedValue({ userId: "u_owner", email: "owner@example.com" }),
}));

const mockSubUpdate = vi.fn();
const mockSubSelect = vi.fn();
vi.mock("@/db", () => ({
  db: {
    update: () => ({ set: (v: unknown) => ({ where: () => mockSubUpdate(v) }) }),
    select: () => ({ from: () => ({ where: () => mockSubSelect() }) }),
  },
}));

const mockSendBillingEmail = vi.fn();
vi.mock("@/lib/billing/email-stub", () => ({ sendBillingEmail: (a: unknown) => mockSendBillingEmail(a) }));

const mockRecordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => mockRecordAudit(a) }));

import { handleInvoicePaymentFailed } from "../invoice-payment-failed";

beforeEach(() => {
  mockInvoicesRetrieve.mockReset();
  mockSubUpdate.mockReset();
  mockSubSelect.mockReset();
  mockSubSelect.mockResolvedValue([]); // default: no existing row
  mockUpdateOrgMeta.mockReset();
  mockSendBillingEmail.mockReset();
  mockRecordAudit.mockReset();
});

describe("handleInvoicePaymentFailed", () => {
  it("resolves firm via subscriptions table (no metadata.firm_id), flips past_due, syncs Clerk, queues email, audits", async () => {
    mockInvoicesRetrieve.mockResolvedValue({
      id: "in_1",
      customer: "cus_1",
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: "sub_1" },
      },
      hosted_invoice_url: "https://stripe/host/in_1",
      metadata: {}, // Stripe never propagates firm_id onto invoices
    });
    mockSubSelect.mockResolvedValue([{ firmId: "org_1" }]);

    await handleInvoicePaymentFailed({
      id: "evt_fail",
      type: "invoice.payment_failed",
      data: { object: { id: "in_1" } },
    } as never);

    expect(mockSubSelect).toHaveBeenCalledTimes(1);
    expect(mockSubUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "past_due" }));
    expect(mockUpdateOrgMeta).toHaveBeenCalledWith(
      "org_1",
      expect.objectContaining({
        publicMetadata: expect.objectContaining({ subscription_status: "past_due" }),
      }),
    );
    expect(mockSendBillingEmail).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "payment_failed", to: "owner@example.com" }),
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "billing.payment_failed", firmId: "org_1" }),
    );
  });

  it("honors metadata.firm_id as an override when present", async () => {
    mockInvoicesRetrieve.mockResolvedValue({
      id: "in_ov",
      customer: "cus_ov",
      subscription: "sub_ov", // legacy location
      hosted_invoice_url: null,
      metadata: { firm_id: "org_override" },
    });

    await handleInvoicePaymentFailed({
      id: "evt_ov",
      type: "invoice.payment_failed",
      data: { object: { id: "in_ov" } },
    } as never);

    // Override wins: we never need the subscriptions lookup.
    expect(mockSubUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "past_due" }));
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ firmId: "org_override" }),
    );
  });

  it("warns + returns (no throw) when the subscription isn't in our DB yet (race)", async () => {
    mockInvoicesRetrieve.mockResolvedValue({
      id: "in_race",
      customer: "cus_race",
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: "sub_race" },
      },
      metadata: {},
    });
    mockSubSelect.mockResolvedValue([]); // sub not committed yet

    await expect(
      handleInvoicePaymentFailed({
        id: "evt_race",
        type: "invoice.payment_failed",
        data: { object: { id: "in_race" } },
      } as never),
    ).resolves.toBeUndefined();

    expect(mockSubUpdate).not.toHaveBeenCalled();
    expect(mockUpdateOrgMeta).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
