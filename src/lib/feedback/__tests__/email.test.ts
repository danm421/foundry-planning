import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockRecordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => mockRecordAudit(a) }));

const mockSend = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: mockSend } };
  }),
}));

import {
  buildFeedbackAcknowledgementEmail,
  buildFeedbackEmail,
  sendFeedbackEmail,
} from "../email";

const base = {
  submission: {
    mode: "feedback" as const,
    type: "bug" as const,
    message: "Estate flow chart renders blank on second death.",
    pageUrl: "https://app.foundryplanning.com/clients/abc/estate-planning",
  },
  context: {
    firmId: "org_1",
    firmName: "Northstar Wealth",
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
    expect(html).toContain("Northstar Wealth");
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
const prevSupportFrom = process.env.SUPPORT_EMAIL_FROM;
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
    ["SUPPORT_EMAIL_FROM", prevSupportFrom],
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
    const arg = mockSend.mock.calls.find(
      (c) => c[0].to === "support@foundryplanning.com",
    )?.[0];
    expect(arg).toBeDefined();
    expect(arg.replyTo).toBe("dana@firm.com");
    expect(arg.attachments).toHaveLength(1);
  });

  it("sends from a support sender, never billing, when SUPPORT_EMAIL_FROM is unset", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.BILLING_EMAIL_FROM = "Foundry <billing@foundryplanning.com>";
    delete process.env.SUPPORT_EMAIL_FROM;
    await sendFeedbackEmail({
      submission: { mode: "support", subject: "x", message: "y" },
      context: base.context,
      attachments: [],
    });
    const arg = mockSend.mock.calls[0][0];
    expect(arg.from).toContain("support@foundryplanning.com");
    expect(arg.from).not.toContain("billing@");
  });

  it("honors an explicit SUPPORT_EMAIL_FROM override", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.SUPPORT_EMAIL_FROM = "Help Desk <help@foundryplanning.com>";
    await sendFeedbackEmail({
      submission: { mode: "support", subject: "x", message: "y" },
      context: base.context,
      attachments: [],
    });
    expect(mockSend.mock.calls[0][0].from).toBe("Help Desk <help@foundryplanning.com>");
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

describe("buildFeedbackAcknowledgementEmail", () => {
  it("thanks the submitter and quotes their message back", () => {
    const { subject, html } = buildFeedbackAcknowledgementEmail(
      base.submission,
      base.context,
    );
    expect(subject).toBe("We got your bug report");
    expect(html).toContain("Estate flow chart renders blank on second death.");
    expect(html).toContain("Hi Dana,");
  });

  it("names a product request rather than calling it a bug", () => {
    const { subject } = buildFeedbackAcknowledgementEmail(
      { mode: "feedback", type: "feature", message: "Add a Roth ladder view" },
      base.context,
    );
    expect(subject).toBe("We got your product request");
  });

  it("echoes the support subject line so the reply threads sensibly", () => {
    const { subject } = buildFeedbackAcknowledgementEmail(
      { mode: "support", subject: "Cannot export PDF", message: "spins" },
      base.context,
    );
    expect(subject).toBe("We got your message: Cannot export PDF");
  });

  it("escapes HTML in the quoted message", () => {
    const { html } = buildFeedbackAcknowledgementEmail(
      { mode: "support", subject: "x", message: "<img src=x onerror=alert(1)>" },
      base.context,
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});

describe("sendFeedbackEmail — submitter acknowledgement", () => {
  it("also sends a confirmation to the person who submitted", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.SUPPORT_EMAIL = "support@foundryplanning.com";
    await sendFeedbackEmail({ ...base, attachments: [] });

    expect(mockSend).toHaveBeenCalledTimes(2);
    const ack = mockSend.mock.calls.find(
      (c) => c[0].to === "dana@firm.com",
    )?.[0];
    expect(ack).toBeDefined();
    expect(ack.subject).toBe("We got your bug report");
    expect(ack.replyTo).toBe("support@foundryplanning.com");
    // The advisor's own screenshots must not be mailed back to them.
    expect(ack.attachments).toBeUndefined();
  });

  it("still reports success when the acknowledgement send fails", async () => {
    process.env.RESEND_API_KEY = "re_test";
    mockSend.mockImplementation((arg: { to: string }) =>
      arg.to === "dana@firm.com"
        ? Promise.reject(new Error("recipient bounced"))
        : Promise.resolve({ data: { id: "re_1" }, error: null }),
    );
    await expect(
      sendFeedbackEmail({ ...base, attachments: [] }),
    ).resolves.toBeUndefined();
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("skips the acknowledgement when the submitter's address is unknown", async () => {
    process.env.RESEND_API_KEY = "re_test";
    await sendFeedbackEmail({
      submission: base.submission,
      context: { ...base.context, advisorEmail: "unknown@unknown" },
      attachments: [],
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].to).not.toBe("unknown@unknown");
  });

  it("sends no acknowledgement when Resend is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    await sendFeedbackEmail({ ...base, attachments: [] });
    expect(mockSend).not.toHaveBeenCalled();
  });
});
