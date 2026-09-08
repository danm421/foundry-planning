import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Unit tests for the trial-cancellation feedback note. The SQL predicate in
 * findTrialCancellations is exercised against a real database separately —
 * asserting it through a mocked drizzle chain would only test the mock.
 */

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  select: vi.fn(),
  send: vi.fn(),
  billingContact: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/db", () => {
  const where = () => Promise.resolve(h.rows);
  const from = () => ({ where, leftJoin: () => ({ where }) });
  return {
    db: {
      select: () => {
        h.select();
        return { from };
      },
    },
  };
});

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (args: unknown) => h.send(args) };
  },
}));

vi.mock("@/lib/billing/billing-contact", () => ({
  resolveBillingContact: (firmId: string) => h.billingContact(firmId),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({ users: { getUser: (id: string) => h.getUser(id) } }),
}));

import {
  buildTrialFeedbackEmail,
  dropAlreadySent,
  findTrialCancellations,
  resolveRecipient,
  sendTrialFeedbackEmail,
  type TrialCancelCandidate,
} from "@/lib/billing/trial-feedback";

// vitest loads .env.local, so RESEND_API_KEY is usually already set here.
// Pin it per test and restore whatever the environment really had.
const REAL_KEY = process.env.RESEND_API_KEY;

function candidate(over: Partial<TrialCancelCandidate> = {}): TrialCancelCandidate {
  return {
    firmId: "org_1",
    firmName: "Acme Advisors",
    subscriptionId: "sub_1",
    canceledAt: new Date("2026-09-06T12:00:00.000Z"),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.rows = [];
  process.env.RESEND_API_KEY = "re_test";
  h.send.mockResolvedValue({ error: null });
});

afterEach(() => {
  if (REAL_KEY === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = REAL_KEY;
  delete process.env.TRIAL_FEEDBACK_FROM;
  delete process.env.TRIAL_FEEDBACK_REPLY_TO;
});

describe("buildTrialFeedbackEmail", () => {
  it("greets by first name when there is one", () => {
    expect(buildTrialFeedbackEmail("Sarah").text).toContain("Hi Sarah,");
  });

  it("falls back to a nameless greeting rather than an empty one", () => {
    const { text } = buildTrialFeedbackEmail(null);
    expect(text).toContain("Hi there,");
    expect(text).not.toContain("Hi ,");
    expect(text).not.toContain("null");
  });

  it("asks the three questions and offers a way out", () => {
    const { text } = buildTrialFeedbackEmail("Sarah");
    expect(text).toContain("1. What were you hoping Foundry would do for you?");
    expect(text).toContain("2. Where did it fall short?");
    expect(text).toContain("3. Did you go with something else instead?");
    expect(text).toContain('Reply "no thanks"');
  });

  it("stays plain text — no markup to make it look like a campaign", () => {
    const { text, subject } = buildTrialFeedbackEmail("Sarah");
    expect(text).not.toMatch(/<[a-z/]/i);
    expect(subject).toBe("Can I ask why you cancelled?");
  });
});

describe("findTrialCancellations", () => {
  it("keeps rows with a cancellation date and drops any without one", async () => {
    h.rows = [
      {
        firmId: "org_1",
        firmName: "Acme",
        subscriptionId: "sub_1",
        canceledAt: new Date("2026-09-06T12:00:00.000Z"),
      },
      { firmId: "org_2", firmName: null, subscriptionId: "sub_2", canceledAt: null },
    ];
    const found = await findTrialCancellations();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ firmId: "org_1", subscriptionId: "sub_1" });
  });
});

describe("dropAlreadySent", () => {
  it("short-circuits on an empty list without touching the audit log", async () => {
    h.rows = [{ resourceId: "sub_1" }];
    expect(await dropAlreadySent([])).toEqual([]);
    expect(h.select).not.toHaveBeenCalled();
  });

  it("removes anyone who already has an audit row", async () => {
    h.rows = [{ resourceId: "sub_1" }];
    const left = await dropAlreadySent([
      candidate({ subscriptionId: "sub_1" }),
      candidate({ subscriptionId: "sub_2", firmId: "org_2" }),
    ]);
    expect(left.map((c) => c.subscriptionId)).toEqual(["sub_2"]);
  });

  it("keeps everyone when nothing has been sent", async () => {
    h.rows = [];
    const left = await dropAlreadySent([candidate(), candidate({ subscriptionId: "sub_2" })]);
    expect(left).toHaveLength(2);
  });
});

describe("resolveRecipient", () => {
  it("returns the billing contact's email and first name", async () => {
    h.billingContact.mockResolvedValue({ userId: "user_1", email: "sarah@acme.com" });
    h.getUser.mockResolvedValue({ firstName: "Sarah" });
    expect(await resolveRecipient("org_1")).toEqual({
      email: "sarah@acme.com",
      firstName: "Sarah",
    });
  });

  it("is null when the firm has no reachable contact", async () => {
    h.billingContact.mockResolvedValue(null);
    expect(await resolveRecipient("org_1")).toBeNull();
  });

  it("is null when the contact has no email address", async () => {
    h.billingContact.mockResolvedValue({ userId: "user_1", email: null });
    expect(await resolveRecipient("org_1")).toBeNull();
  });

  it("still sends when Clerk cannot supply the name", async () => {
    h.billingContact.mockResolvedValue({ userId: "user_1", email: "sarah@acme.com" });
    h.getUser.mockRejectedValue(new Error("clerk down"));
    expect(await resolveRecipient("org_1")).toEqual({
      email: "sarah@acme.com",
      firstName: null,
    });
  });
});

describe("sendTrialFeedbackEmail", () => {
  const to = { email: "sarah@acme.com", firstName: "Sarah" };

  it("sends plain text from Dan with a reply-to that reaches him", async () => {
    const { delivered } = await sendTrialFeedbackEmail(to);
    expect(delivered).toBe(true);
    const sent = h.send.mock.calls[0][0];
    expect(sent).toMatchObject({
      to: "sarah@acme.com",
      from: "Dan Mueller <dan@foundryplanning.com>",
      replyTo: "dan@foundryplanning.com",
      subject: "Can I ask why you cancelled?",
    });
    expect(sent.text).toContain("Hi Sarah,");
    expect(sent.html).toBeUndefined();
  });

  it("honours a sender override", async () => {
    process.env.TRIAL_FEEDBACK_FROM = "D <d@example.com>";
    process.env.TRIAL_FEEDBACK_REPLY_TO = "reply@example.com";
    await sendTrialFeedbackEmail(to);
    expect(h.send.mock.calls[0][0]).toMatchObject({
      from: "D <d@example.com>",
      replyTo: "reply@example.com",
    });
  });

  it("reports undelivered when Resend is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    expect(await sendTrialFeedbackEmail(to)).toEqual({ delivered: false });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("reports undelivered on a rejection rather than treating it as sent", async () => {
    h.send.mockResolvedValue({ error: { message: "domain not verified" } });
    expect(await sendTrialFeedbackEmail(to)).toEqual({ delivered: false });
  });

  it("reports undelivered when the call throws", async () => {
    h.send.mockRejectedValue(new Error("network"));
    expect(await sendTrialFeedbackEmail(to)).toEqual({ delivered: false });
  });
});
