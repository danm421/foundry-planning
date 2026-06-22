import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { sendIntakeFormEmail } from "../email";

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
        householdName: "Smith Family",
      }),
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing with minimal args (no advisorName/householdName)", async () => {
    await expect(
      sendIntakeFormEmail({
        to: "client@example.com",
        link: "https://foundryplanning.com/intake/abc123",
      }),
    ).resolves.toBeUndefined();
  });
});
