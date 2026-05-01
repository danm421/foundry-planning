import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDisputesRetrieve = vi.fn();
const mockChargesRetrieve = vi.fn();
vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({
    disputes: { retrieve: (...a: unknown[]) => mockDisputesRetrieve(...a) },
    charges: { retrieve: (...a: unknown[]) => mockChargesRetrieve(...a) },
  }),
}));

const mockSentryCapture = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...a: unknown[]) => mockSentryCapture(...a),
}));

const mockRecordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => mockRecordAudit(a) }));

import { handleChargeDisputeCreated } from "../charge-dispute-created";

beforeEach(() => {
  mockDisputesRetrieve.mockReset();
  mockChargesRetrieve.mockReset();
  mockSentryCapture.mockReset();
  mockRecordAudit.mockReset();
});

describe("handleChargeDisputeCreated", () => {
  it("Sentry-alerts and audits with the firm context", async () => {
    mockDisputesRetrieve.mockResolvedValue({
      id: "dp_1",
      charge: "ch_1",
      amount: 9900,
      currency: "usd",
      reason: "fraudulent",
    });
    mockChargesRetrieve.mockResolvedValue({
      id: "ch_1",
      metadata: { firm_id: "org_1" },
    });
    await handleChargeDisputeCreated({
      id: "evt_dp",
      type: "charge.dispute.created",
      data: { object: { id: "dp_1" } },
    } as never);
    expect(mockSentryCapture).toHaveBeenCalledWith(
      "Stripe dispute created",
      expect.objectContaining({
        level: "warning",
        extra: expect.objectContaining({ disputeId: "dp_1", firmId: "org_1" }),
      }),
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "billing.dispute_created" }),
    );
  });
});
