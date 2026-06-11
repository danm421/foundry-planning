import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoicesRetrieve = vi.fn();
vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({
    invoices: { retrieve: (...a: unknown[]) => mockInvoicesRetrieve(...a) },
  }),
}));

vi.mock("@/lib/billing/billing-contact", () => ({
  resolveBillingContact: vi.fn().mockResolvedValue({ userId: "u_owner", email: "o@e.com" }),
}));

const mockSubSelect = vi.fn();
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => mockSubSelect() }) }) },
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
  mockSubSelect.mockReset();
  mockSubSelect.mockResolvedValue([]); // default: no existing row
  mockSendBillingEmail.mockReset();
  mockRecordAudit.mockReset();
});

describe("handleInvoicePaymentActionRequired", () => {
  it("resolves firm via subscriptions table (no metadata.firm_id), queues email + audits, no status flip", async () => {
    mockInvoicesRetrieve.mockResolvedValue({
      id: "in_3ds",
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: "sub_3ds" },
      },
      hosted_invoice_url: "https://stripe/host/in_3ds",
      metadata: {},
    });
    mockSubSelect.mockResolvedValue([{ firmId: "org_1" }]);

    await handleInvoicePaymentActionRequired({
      id: "evt_3ds",
      type: "invoice.payment_action_required",
      data: { object: { id: "in_3ds" } },
    } as never);

    expect(mockSubSelect).toHaveBeenCalledTimes(1);
    expect(mockSendBillingEmail).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "payment_action_required", firmId: "org_1", to: "o@e.com" }),
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ firmId: "org_1" }),
    );
  });

  it("warns + returns (no throw) when the subscription isn't in our DB yet (race)", async () => {
    mockInvoicesRetrieve.mockResolvedValue({
      id: "in_race",
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: "sub_race" },
      },
      metadata: {},
    });
    mockSubSelect.mockResolvedValue([]); // sub not committed yet

    await expect(
      handleInvoicePaymentActionRequired({
        id: "evt_race",
        type: "invoice.payment_action_required",
        data: { object: { id: "in_race" } },
      } as never),
    ).resolves.toBeUndefined();

    expect(mockSendBillingEmail).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
