import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_INTAKE_REOPENED_INTRO, DEFAULT_INTAKE_SUBJECT } from "../defaults";

vi.mock("@clerk/nextjs/server", () => ({
  currentUser: async () => ({ firstName: "Pat", lastName: "Advisor", primaryEmailAddress: null }),
}));
vi.mock("@/lib/activity/resolve-firm-names", () => ({ resolveFirmName: async () => "Acme Wealth" }));
vi.mock("@/lib/branding/advisor-profile", () => ({ getAdvisorProfile: async () => null }));

// The advisor's saved copy — first-send wording the reopened mail must not reuse.
const settingsRow = { subject: "Your planning details", introBody: "It takes about 10 minutes." };
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: async () => [settingsRow] }) }) },
}));

const sendMock = vi.fn();
vi.mock("@/lib/intake/email", () => ({
  sendIntakeFormEmail: (args: unknown) => sendMock(args),
}));

import { sendIntakeLinkEmail } from "../send-form-email";

const base = {
  firmId: "firm-1",
  senderUserId: "advisor-1",
  brandAdvisorUserId: "advisor-1",
  to: "sam@client.com",
  link: "https://app.example/intake/tok",
};

beforeEach(() => {
  sendMock.mockReset().mockResolvedValue({ delivered: true });
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
