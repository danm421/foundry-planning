import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDisputesRetrieve = vi.fn();
const mockChargesRetrieve = vi.fn();
vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({
    disputes: { retrieve: (...a: unknown[]) => mockDisputesRetrieve(...a) },
    charges: { retrieve: (...a: unknown[]) => mockChargesRetrieve(...a) },
  }),
}));

const mockRecordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => mockRecordAudit(a) }));

const mockCaptureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...a: unknown[]) => mockCaptureMessage(...a),
}));

import { handleChargeDisputeClosed } from "../charge-dispute-closed";

beforeEach(() => {
  mockDisputesRetrieve.mockReset();
  mockChargesRetrieve.mockReset();
  mockRecordAudit.mockReset();
  mockCaptureMessage.mockReset();
});

describe("handleChargeDisputeClosed", () => {
  it("audits the won/lost outcome with the resolved firm", async () => {
    mockDisputesRetrieve.mockResolvedValue({
      id: "dp_1",
      charge: "ch_1",
      status: "won",
      amount: 9900,
      currency: "usd",
      reason: "fraudulent",
    });
    mockChargesRetrieve.mockResolvedValue({ id: "ch_1", metadata: { firm_id: "org_1" } });

    await handleChargeDisputeClosed({
      id: "evt_dp_closed",
      type: "charge.dispute.closed",
      data: { object: { id: "dp_1" } },
    } as never);

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "billing.dispute_closed",
        firmId: "org_1",
        metadata: expect.objectContaining({ status: "won" }),
      }),
    );
  });

  it("falls back to firm_id 'unknown' when the charge has no metadata", async () => {
    mockDisputesRetrieve.mockResolvedValue({
      id: "dp_2",
      charge: "ch_2",
      status: "lost",
      amount: 9900,
      currency: "usd",
      reason: "general",
    });
    mockChargesRetrieve.mockResolvedValue({ id: "ch_2", metadata: {} });

    await handleChargeDisputeClosed({
      id: "evt_dp_closed_2",
      type: "charge.dispute.closed",
      data: { object: { id: "dp_2" } },
    } as never);

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ firmId: "unknown", metadata: expect.objectContaining({ status: "lost" }) }),
    );
  });
});
