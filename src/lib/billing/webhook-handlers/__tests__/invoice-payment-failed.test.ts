import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoicesRetrieve = vi.fn();
vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({ invoices: { retrieve: (...a: unknown[]) => mockInvoicesRetrieve(...a) } }),
}));

const mockUpdateOrgMeta = vi.fn();
const mockListMembers = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    organizations: {
      updateOrganizationMetadata: (...a: unknown[]) => mockUpdateOrgMeta(...a),
      getOrganizationMembershipList: (...a: unknown[]) => mockListMembers(...a),
    },
  }),
}));

const mockSubUpdate = vi.fn();
vi.mock("@/db", () => ({
  db: { update: () => ({ set: (v: unknown) => ({ where: () => mockSubUpdate(v) }) }) },
}));

const mockSendBillingEmail = vi.fn();
vi.mock("@/lib/billing/email-stub", () => ({ sendBillingEmail: (a: unknown) => mockSendBillingEmail(a) }));

const mockRecordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => mockRecordAudit(a) }));

import { handleInvoicePaymentFailed } from "../invoice-payment-failed";

beforeEach(() => {
  mockInvoicesRetrieve.mockReset();
  mockSubUpdate.mockReset();
  mockUpdateOrgMeta.mockReset();
  mockListMembers.mockReset();
  mockSendBillingEmail.mockReset();
  mockRecordAudit.mockReset();
});

describe("handleInvoicePaymentFailed", () => {
  it("flips parent sub to past_due, syncs Clerk, queues email, audits", async () => {
    mockInvoicesRetrieve.mockResolvedValue({
      id: "in_1",
      customer: "cus_1",
      subscription: "sub_1",
      hosted_invoice_url: "https://stripe/host/in_1",
      metadata: { firm_id: "org_1" },
    });
    mockListMembers.mockResolvedValue({
      data: [{ role: "org:owner", publicUserData: { identifier: "owner@example.com" } }],
    });

    await handleInvoicePaymentFailed({
      id: "evt_fail",
      type: "invoice.payment_failed",
      data: { object: { id: "in_1" } },
    } as never);

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
      expect.objectContaining({ action: "billing.payment_failed" }),
    );
  });
});
