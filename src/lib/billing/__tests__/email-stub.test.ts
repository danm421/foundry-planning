import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRecordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => mockRecordAudit(a) }));

import { sendBillingEmail } from "../email-stub";

beforeEach(() => mockRecordAudit.mockReset());

describe("sendBillingEmail", () => {
  it("writes a billing.email_queued audit row with the kind + payload", async () => {
    await sendBillingEmail({
      kind: "trial_ending_3d",
      to: "owner@example.com",
      firmId: "org_1",
      payload: { trialEnd: "2026-05-15T00:00:00Z" },
    });
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).toHaveBeenCalledWith({
      action: "billing.email_queued",
      resourceType: "firm",
      resourceId: "org_1",
      firmId: "org_1",
      actorId: "system:email-stub",
      metadata: {
        kind: "trial_ending_3d",
        to: "owner@example.com",
        payload: { trialEnd: "2026-05-15T00:00:00Z" },
      },
    });
  });

  it("never throws — audit failure is swallowed", async () => {
    mockRecordAudit.mockRejectedValueOnce(new Error("audit boom"));
    await expect(
      sendBillingEmail({
        kind: "payment_failed",
        to: "x@y.com",
        firmId: "org_1",
        payload: {},
      }),
    ).resolves.toBeUndefined();
  });
});
