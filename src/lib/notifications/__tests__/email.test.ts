import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const send = vi.fn();

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send } };
  }),
}));

import { sendDigestEmail } from "../email";

const ARGS = { to: "advisor@example.com", subject: "Updates", html: "<p>hi</p>" };

describe("sendDigestEmail", () => {
  const originalKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    send.mockReset();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  });

  it("skips the send and reports undelivered when RESEND_API_KEY is unset", async () => {
    delete process.env.RESEND_API_KEY;

    const result = await sendDigestEmail(ARGS);

    expect(result).toEqual({ delivered: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("reports delivered when Resend resolves without an error", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    send.mockResolvedValue({ data: { id: "email_123" }, error: null });

    const result = await sendDigestEmail(ARGS);

    expect(result).toEqual({ delivered: true });
  });

  it("reports undelivered when Resend resolves an error (e.g. rate limit)", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    send.mockResolvedValue({
      data: null,
      error: { name: "rate_limit_exceeded", statusCode: 429, message: "Too many requests" },
    });

    const result = await sendDigestEmail(ARGS);

    expect(result).toEqual({ delivered: false });
  });
});
