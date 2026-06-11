import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockRecordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => mockRecordAudit(a) }));

const mockSend = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: mockSend } };
  }),
}));

import { buildFeedbackEmail, sendFeedbackEmail } from "../email";

const base = {
  submission: {
    mode: "feedback" as const,
    type: "bug" as const,
    message: "Estate flow chart renders blank on second death.",
    pageUrl: "https://app.foundryplanning.com/clients/abc/estate-planning",
  },
  context: {
    firmId: "org_1",
    advisorName: "Dana Advisor",
    advisorEmail: "dana@firm.com",
    userAgent: "Mozilla/5.0",
    submittedAt: "2026-06-11T12:00:00.000Z",
  },
};

describe("buildFeedbackEmail", () => {
  it("derives a [Bug] subject and embeds context in the body", () => {
    const { subject, html } = buildFeedbackEmail(base.submission, base.context);
    expect(subject).toMatch(/^\[Bug\]/);
    expect(html).toContain("dana@firm.com");
    expect(html).toContain("org_1");
    expect(html).toContain("estate-planning");
  });

  it("derives a [Support] subject from the support subject line", () => {
    const { subject } = buildFeedbackEmail(
      { mode: "support", subject: "Cannot export PDF", message: "spins" },
      base.context,
    );
    expect(subject).toBe("[Support] Cannot export PDF");
  });
});

const prevKey = process.env.RESEND_API_KEY;
const prevFrom = process.env.BILLING_EMAIL_FROM;
const prevTo = process.env.SUPPORT_EMAIL;

beforeEach(() => {
  mockRecordAudit.mockReset();
  mockSend.mockReset();
  mockSend.mockResolvedValue({ data: { id: "re_1" }, error: null });
});
afterEach(() => {
  for (const [k, v] of [
    ["RESEND_API_KEY", prevKey],
    ["BILLING_EMAIL_FROM", prevFrom],
    ["SUPPORT_EMAIL", prevTo],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("sendFeedbackEmail", () => {
  it("always writes a feedback.submitted audit row", async () => {
    delete process.env.RESEND_API_KEY;
    await sendFeedbackEmail({ ...base, attachments: [] });
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit.mock.calls[0][0]).toMatchObject({
      action: "feedback.submitted",
      firmId: "org_1",
    });
  });

  it("sends via Resend with reply-to and attachments when configured", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.BILLING_EMAIL_FROM = "Foundry <no-reply@foundryplanning.com>";
    process.env.SUPPORT_EMAIL = "support@foundryplanning.com";
    await sendFeedbackEmail({
      ...base,
      attachments: [{ filename: "shot.png", content: Buffer.from([1, 2, 3]) }],
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const arg = mockSend.mock.calls[0][0];
    expect(arg.to).toBe("support@foundryplanning.com");
    expect(arg.replyTo).toBe("dana@firm.com");
    expect(arg.attachments).toHaveLength(1);
  });

  it("uses support.message_sent action for support mode", async () => {
    delete process.env.RESEND_API_KEY;
    await sendFeedbackEmail({
      submission: { mode: "support", subject: "x", message: "y" },
      context: base.context,
      attachments: [],
    });
    expect(mockRecordAudit.mock.calls[0][0]).toMatchObject({
      action: "support.message_sent",
    });
  });
});
