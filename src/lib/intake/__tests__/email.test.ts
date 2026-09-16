import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

const mockSend = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: mockSend } };
  }),
}));

import { sendIntakeFormEmail } from "../email";
import { buildIntakeFromHeader } from "../email-template";

describe("sendIntakeFormEmail", () => {
  let savedApiKey: string | undefined;

  beforeEach(() => {
    savedApiKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    if (savedApiKey !== undefined) {
      process.env.RESEND_API_KEY = savedApiKey;
    } else {
      delete process.env.RESEND_API_KEY;
    }
  });

  it("reports undelivered rather than throwing when RESEND_API_KEY is not set", async () => {
    await expect(
      sendIntakeFormEmail({
        to: "client@example.com",
        link: "https://foundryplanning.com/intake/abc123",
        advisorName: "Jane Advisor",
        clientName: "Smith Family",
      }),
    ).resolves.toEqual({ delivered: false, reason: "unconfigured" });
  });

  it("resolves without throwing with minimal args (no advisorName/clientName)", async () => {
    await expect(
      sendIntakeFormEmail({
        to: "client@example.com",
        link: "https://foundryplanning.com/intake/abc123",
      }),
    ).resolves.toEqual({ delivered: false, reason: "unconfigured" });
  });

  it("reports delivered once Resend accepts the send", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    mockSend.mockClear();
    mockSend.mockResolvedValueOnce({ data: { id: "re_1" }, error: null });

    await expect(
      sendIntakeFormEmail({
        to: "client@example.com",
        link: "https://foundryplanning.com/intake/abc123",
      }),
    ).resolves.toEqual({ delivered: true });
  });

  it("reports send_failed — never throws — when the transport throws", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    mockSend.mockClear();
    mockSend.mockRejectedValueOnce(new Error("resend is down"));

    await expect(
      sendIntakeFormEmail({
        to: "client@example.com",
        link: "https://foundryplanning.com/intake/abc123",
      }),
    ).resolves.toEqual({ delivered: false, reason: "send_failed" });
  });

  // The throw above is the RARE failure. Resend's SDK resolves
  // { data: null, error } for every non-2xx — an unknown recipient, a quota,
  // a suppressed address — and those are the failures that actually happen.
  // Reading only the thrown path reports `delivered: true` for mail that was
  // never accepted, which is what the reminder route's 502 hangs off.
  it("reports send_failed when Resend RESOLVES an error instead of throwing", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    mockSend.mockClear();
    mockSend.mockResolvedValueOnce({
      data: null,
      error: { name: "validation_error", message: "Invalid `to` field." },
    });

    await expect(
      sendIntakeFormEmail({
        to: "nobody@example.com",
        link: "https://foundryplanning.com/intake/abc123",
      }),
    ).resolves.toEqual({ delivered: false, reason: "send_failed" });
  });

  it("passes replyTo through to the Resend payload", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    mockSend.mockClear();
    mockSend.mockResolvedValueOnce({ data: { id: "re_1" }, error: null });

    await sendIntakeFormEmail({
      to: "client@example.com",
      link: "https://foundryplanning.com/intake/abc123",
      replyTo: "jane@smithwealth.com",
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const arg = mockSend.mock.calls[0]![0] as { replyTo?: string };
    expect(arg.replyTo).toBe("jane@smithwealth.com");
  });
});

describe("buildIntakeFromHeader", () => {
  let savedFrom: string | undefined;

  beforeEach(() => {
    savedFrom = process.env.INTAKE_EMAIL_FROM;
    delete process.env.INTAKE_EMAIL_FROM;
  });

  afterEach(() => {
    if (savedFrom !== undefined) {
      process.env.INTAKE_EMAIL_FROM = savedFrom;
    } else {
      delete process.env.INTAKE_EMAIL_FROM;
    }
  });

  it("falls back to Foundry on our domain when no org name is given", () => {
    expect(buildIntakeFromHeader()).toBe(
      '"Foundry" <noreply@foundryplanning.com>',
    );
  });

  it("falls back to Foundry for a blank/whitespace org name", () => {
    expect(buildIntakeFromHeader("   ")).toBe(
      '"Foundry" <noreply@foundryplanning.com>',
    );
  });

  it("uses the org name as the display name on our verified domain", () => {
    expect(buildIntakeFromHeader("Acme Wealth Management")).toBe(
      '"Acme Wealth Management" <noreply@foundryplanning.com>',
    );
  });

  it("escapes double-quotes and backslashes in the org name", () => {
    expect(buildIntakeFromHeader('Acme "Premier" \\ Co')).toBe(
      '"Acme \\"Premier\\" \\\\ Co" <noreply@foundryplanning.com>',
    );
  });

  it("strips CR/LF and control chars (header-injection guard)", () => {
    expect(
      buildIntakeFromHeader("Acme\r\nBcc: evil@example.com"),
    ).toBe('"Acme Bcc: evil@example.com" <noreply@foundryplanning.com>');
  });

  it("honors an explicit INTAKE_EMAIL_FROM override verbatim", () => {
    process.env.INTAKE_EMAIL_FROM = "Custom <hi@example.com>";
    expect(buildIntakeFromHeader("Acme Wealth Management")).toBe(
      "Custom <hi@example.com>",
    );
  });
});
