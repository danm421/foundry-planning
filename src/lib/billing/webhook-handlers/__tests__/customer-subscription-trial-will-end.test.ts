import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSubsRetrieve = vi.fn();
vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({
    subscriptions: { retrieve: (...a: unknown[]) => mockSubsRetrieve(...a) },
  }),
}));

vi.mock("@/lib/billing/billing-contact", () => ({
  resolveBillingContact: vi.fn().mockResolvedValue({ userId: "u_owner", email: "owner@example.com" }),
}));

const mockSendBillingEmail = vi.fn();
vi.mock("@/lib/billing/email-stub", () => ({
  sendBillingEmail: (a: unknown) => mockSendBillingEmail(a),
}));

const mockRecordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  recordAudit: (a: unknown) => mockRecordAudit(a),
}));

import { handleTrialWillEnd } from "../customer-subscription-trial-will-end";

beforeEach(() => {
  mockSubsRetrieve.mockReset();
  mockSendBillingEmail.mockReset();
  mockRecordAudit.mockReset();
});

describe("handleTrialWillEnd", () => {
  it("queues a trial_ending_3d email to the org owner and audits", async () => {
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_1",
      trial_end: 1700000000,
      metadata: { firm_id: "org_1" },
    });

    await handleTrialWillEnd({
      id: "evt_trial",
      type: "customer.subscription.trial_will_end",
      data: { object: { id: "sub_1" } },
    } as never);

    expect(mockSendBillingEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "trial_ending_3d",
        to: "owner@example.com",
        firmId: "org_1",
      }),
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "billing.subscription_updated" }),
    );
  });
});
