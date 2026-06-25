import { describe, it, expect, afterEach, beforeEach } from "vitest";
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

  it("resolves without throwing when RESEND_API_KEY is not set", async () => {
    await expect(
      sendIntakeFormEmail({
        to: "client@example.com",
        link: "https://foundryplanning.com/intake/abc123",
        advisorName: "Jane Advisor",
        clientName: "Smith Family",
      }),
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing with minimal args (no advisorName/clientName)", async () => {
    await expect(
      sendIntakeFormEmail({
        to: "client@example.com",
        link: "https://foundryplanning.com/intake/abc123",
      }),
    ).resolves.toBeUndefined();
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
