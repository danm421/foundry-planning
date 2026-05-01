import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoicesRetrieve = vi.fn();
vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({
    invoices: { retrieve: (...a: unknown[]) => mockInvoicesRetrieve(...a) },
  }),
}));

const mockListMembers = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    organizations: {
      getOrganizationMembershipList: (...a: unknown[]) =>
        mockListMembers(...a),
    },
  }),
}));

const mockSendBillingEmail = vi.fn();
vi.mock("@/lib/billing/email-stub", () => ({
  sendBillingEmail: (a: unknown) => mockSendBillingEmail(a),
}));

const mockRecordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  recordAudit: (a: unknown) => mockRecordAudit(a),
}));

import { handleInvoicePaymentActionRequired } from "../invoice-payment-action-required";

beforeEach(() => {
  mockInvoicesRetrieve.mockReset();
  mockListMembers.mockReset();
  mockSendBillingEmail.mockReset();
  mockRecordAudit.mockReset();
});

describe("handleInvoicePaymentActionRequired", () => {
  it("queues recovery email + audits, no status flip", async () => {
    mockInvoicesRetrieve.mockResolvedValue({
      id: "in_3ds",
      hosted_invoice_url: "https://stripe/host/in_3ds",
      metadata: { firm_id: "org_1" },
    });
    mockListMembers.mockResolvedValue({
      data: [{ role: "org:owner", publicUserData: { identifier: "o@e.com" } }],
    });
    await handleInvoicePaymentActionRequired({
      id: "evt_3ds",
      type: "invoice.payment_action_required",
      data: { object: { id: "in_3ds" } },
    } as never);
    expect(mockSendBillingEmail).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "payment_action_required" }),
    );
    expect(mockRecordAudit).toHaveBeenCalled();
  });
});
