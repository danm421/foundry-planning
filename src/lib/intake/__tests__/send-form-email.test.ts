import { describe, it, expect, vi, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { intakeEmailSettings } from "@/db/schema";
import { DEFAULT_INTAKE_REOPENED_INTRO, DEFAULT_INTAKE_SUBJECT } from "../defaults";

vi.mock("@clerk/nextjs/server", () => ({
  currentUser: async () => ({ firstName: "Pat", lastName: "Advisor", primaryEmailAddress: null }),
}));
vi.mock("@/lib/activity/resolve-firm-names", () => ({ resolveFirmName: async () => "Acme Wealth" }));

const profileMock = vi.fn();
vi.mock("@/lib/branding/advisor-profile", () => ({
  getAdvisorProfile: (...a: unknown[]) => profileMock(...a),
}));
vi.mock("@/lib/crm-tasks/members", () => ({
  listFirmMembers: async () => [
    { userId: "advisor-2", displayName: "Jane Smith", email: "jane@smith.test", imageUrl: null, role: "Member", roleKey: "org:member" },
  ],
}));

// The saved copy — first-send wording the reopened mail must not reuse. The
// where() is recorded so a test can say WHOSE saved copy was read.
const settingsRow = { subject: "Your planning details", introBody: "It takes about 10 minutes." };
const whereMock = vi.fn(async (_cond: unknown) => [settingsRow]);
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: (c: unknown) => whereMock(c) }) }) },
}));

const sendMock = vi.fn();
vi.mock("@/lib/intake/email", () => ({
  sendIntakeFormEmail: (args: unknown) => sendMock(args),
}));

import { sendIntakeLinkEmail } from "../send-form-email";

const base = {
  firmId: "firm-1",
  senderUserId: "advisor-1",
  brand: "advisor-1",
  to: "sam@client.com",
  link: "https://app.example/intake/tok",
};

const brandOn = {
  brandingEnabled: true,
  brandName: "Smith Wealth",
  emailFromName: "Jane Smith CFP",
  emailReplyTo: "jane@smithwealth.test",
};

const settingsOf = (userId: string) =>
  and(eq(intakeEmailSettings.firmId, "firm-1"), eq(intakeEmailSettings.userId, userId));

beforeEach(() => {
  sendMock.mockReset().mockResolvedValue({ delivered: true });
  profileMock.mockReset().mockResolvedValue(null);
  whereMock.mockClear();
});

describe("sendIntakeLinkEmail", () => {
  it("a first send uses the advisor's saved subject and intro as-is", async () => {
    await sendIntakeLinkEmail(base);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Your planning details", introBody: "It takes about 10 minutes." }),
    );
  });

  it("a reminder prefixes the subject and keeps the saved intro", async () => {
    await sendIntakeLinkEmail({ ...base, followUp: "reminder" });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Reminder: Your planning details",
        introBody: "It takes about 10 minutes.",
      }),
    );
  });

  it("a reopened form says so, in the subject and in place of the first-send intro", async () => {
    await sendIntakeLinkEmail({ ...base, followUp: "reopened" });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Reopened: Your planning details",
        introBody: DEFAULT_INTAKE_REOPENED_INTRO,
      }),
    );
  });

  it("a follow-up with no saved subject prefixes the default one", async () => {
    settingsRow.subject = "";
    try {
      await sendIntakeLinkEmail({ ...base, followUp: "reopened" });
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({ subject: `Reopened: ${DEFAULT_INTAKE_SUBJECT}` }),
      );
    } finally {
      settingsRow.subject = "Your planning details";
    }
  });
});

describe("sendIntakeLinkEmail — who it speaks as", () => {
  it("an advisor brand that is on signs as that advisor, in their wording, under their brand name", async () => {
    profileMock.mockResolvedValue(brandOn);
    await sendIntakeLinkEmail({ ...base, brand: "advisor-2" });

    expect(profileMock).toHaveBeenCalledWith("firm-1", "advisor-2");
    expect(whereMock).toHaveBeenCalledWith(settingsOf("advisor-2"));
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        advisorName: "Jane Smith",
        advisorEmail: "jane@smith.test",
        firmName: "Smith Wealth",
        fromName: "Jane Smith CFP",
        replyTo: "jane@smithwealth.test",
      }),
    );
  });

  it("the firm brand signs as the sender, under the firm's name", async () => {
    await sendIntakeLinkEmail({ ...base, brand: "firm" });

    expect(profileMock).not.toHaveBeenCalled();
    expect(whereMock).toHaveBeenCalledWith(settingsOf("advisor-1"));
    const args = sendMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(args).toMatchObject({ advisorName: "Pat Advisor", firmName: "Acme Wealth" });
    expect(args.replyTo).toBeUndefined();
  });

  it("an advisor brand that is off signs as the sender", async () => {
    profileMock.mockResolvedValue({ ...brandOn, brandingEnabled: false });
    await sendIntakeLinkEmail({ ...base, brand: "advisor-2" });

    expect(whereMock).toHaveBeenCalledWith(settingsOf("advisor-1"));
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ advisorName: "Pat Advisor", firmName: "Acme Wealth" }),
    );
  });

  it("an advisor who has left the firm signs as the sender", async () => {
    profileMock.mockResolvedValue(brandOn);
    await sendIntakeLinkEmail({ ...base, brand: "advisor-gone" });

    const args = sendMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(args).toMatchObject({ advisorName: "Pat Advisor", firmName: "Acme Wealth" });
    expect(args.fromName).toBeUndefined();
    expect(args.replyTo).toBeUndefined();
  });
});
