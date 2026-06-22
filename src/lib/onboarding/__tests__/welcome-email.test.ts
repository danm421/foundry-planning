import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSend = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: mockSend } };
  }),
}));

import { sendWelcomeEmail, renderWelcomeText } from "../welcome-email";

const prevKey = process.env.RESEND_API_KEY;
const prevFrom = process.env.WELCOME_EMAIL_FROM;

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({ data: { id: "re_1" }, error: null });
});
afterEach(() => {
  if (prevKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = prevKey;
  if (prevFrom === undefined) delete process.env.WELCOME_EMAIL_FROM;
  else process.env.WELCOME_EMAIL_FROM = prevFrom;
});

describe("renderWelcomeText", () => {
  it("personalizes the greeting when a first name is present", () => {
    expect(renderWelcomeText("Sarah")).toContain("Hi Sarah,");
  });
  it("falls back to a generic greeting when first name is null or blank", () => {
    expect(renderWelcomeText(null)).toContain("Hi there,");
    expect(renderWelcomeText("   ")).toContain("Hi there,");
  });
  it("is signed by Dan", () => {
    expect(renderWelcomeText("Sarah")).toContain("Dan");
  });
});

describe("sendWelcomeEmail", () => {
  it("does NOT call Resend when RESEND_API_KEY is unset", async () => {
    delete process.env.RESEND_API_KEY;
    await sendWelcomeEmail({ to: "new@example.com", firstName: "Sarah" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends a plain-text email with the default From and reply-to when configured", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    delete process.env.WELCOME_EMAIL_FROM;
    await sendWelcomeEmail({ to: "new@example.com", firstName: "Sarah" });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const arg = mockSend.mock.calls[0]![0] as {
      from: string;
      to: string;
      replyTo: string;
      subject: string;
      text: string;
      html?: string;
    };
    expect(arg.from).toBe("Dan Mueller <dan@foundryplanning.com>");
    expect(arg.to).toBe("new@example.com");
    expect(arg.replyTo).toBe("dan@foundryplanning.com");
    expect(arg.subject).toBe("Welcome to Foundry");
    expect(arg.text).toContain("Hi Sarah,");
    expect(arg.html).toBeUndefined();
  });

  it("honors WELCOME_EMAIL_FROM override", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.WELCOME_EMAIL_FROM = "Dan <dan@foundryplanning.com>";
    await sendWelcomeEmail({ to: "new@example.com", firstName: null });
    const arg = mockSend.mock.calls[0]![0] as { from: string; text: string };
    expect(arg.from).toBe("Dan <dan@foundryplanning.com>");
    expect(arg.text).toContain("Hi there,");
  });

  it("never throws when Resend rejects", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    mockSend.mockRejectedValueOnce(new Error("resend down"));
    await expect(
      sendWelcomeEmail({ to: "new@example.com", firstName: "Sarah" }),
    ).resolves.toBeUndefined();
  });
});
