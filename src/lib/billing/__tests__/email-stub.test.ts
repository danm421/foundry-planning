// src/lib/billing/__tests__/email-stub.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockRecordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => mockRecordAudit(a) }));

const mockSend = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: mockSend } };
  }),
}));

import { sendBillingEmail } from "../email-stub";

const prevKey = process.env.RESEND_API_KEY;
const prevFrom = process.env.BILLING_EMAIL_FROM;

beforeEach(() => {
  mockRecordAudit.mockReset();
  mockSend.mockReset();
  mockSend.mockResolvedValue({ data: { id: "re_1" }, error: null });
});
afterEach(() => {
  if (prevKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = prevKey;
  if (prevFrom === undefined) delete process.env.BILLING_EMAIL_FROM;
  else process.env.BILLING_EMAIL_FROM = prevFrom;
});

describe("sendBillingEmail", () => {
  it("writes a billing.email_queued audit row with the kind + payload", async () => {
    delete process.env.RESEND_API_KEY;
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
    delete process.env.RESEND_API_KEY;
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

  it("does NOT call Resend when RESEND_API_KEY is unset", async () => {
    delete process.env.RESEND_API_KEY;
    await sendBillingEmail({
      kind: "payment_failed",
      to: "x@y.com",
      firmId: "org_1",
      payload: { invoiceUrl: "https://invoice.stripe.com/i/abc" },
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends via Resend with the right from/to/subject per kind when configured", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.BILLING_EMAIL_FROM = "Foundry <billing@foundryplanning.com>";
    await sendBillingEmail({
      kind: "payment_failed",
      to: "owner@example.com",
      firmId: "org_1",
      payload: { invoiceUrl: "https://invoice.stripe.com/i/abc", invoiceId: "in_abc" },
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const arg = mockSend.mock.calls[0]![0] as {
      from: string;
      to: string;
      subject: string;
      html: string;
    };
    expect(arg.from).toBe("Foundry <billing@foundryplanning.com>");
    expect(arg.to).toBe("owner@example.com");
    expect(arg.subject).toMatch(/payment/i);
    expect(arg.html).toContain("https://invoice.stripe.com/i/abc");
  });

  it("sends the trial template for trial_ending_3d", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.BILLING_EMAIL_FROM = "Foundry <billing@foundryplanning.com>";
    await sendBillingEmail({
      kind: "trial_ending_3d",
      to: "owner@example.com",
      firmId: "org_1",
      payload: { trialEnd: "2026-06-20T00:00:00.000Z" },
    });
    const arg = mockSend.mock.calls[0]![0] as { subject: string; html: string };
    expect(arg.subject).toMatch(/trial/i);
    expect(arg.html).toContain("2026-06-20");
  });

  it("never throws when Resend rejects — error is swallowed", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.BILLING_EMAIL_FROM = "Foundry <billing@foundryplanning.com>";
    mockSend.mockRejectedValueOnce(new Error("resend down"));
    await expect(
      sendBillingEmail({
        kind: "payment_action_required",
        to: "owner@example.com",
        firmId: "org_1",
        payload: { invoiceUrl: "https://invoice.stripe.com/i/xyz", invoiceId: "in_xyz" },
      }),
    ).resolves.toBeUndefined();
  });
});
