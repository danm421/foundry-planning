import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const send = vi.fn();

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send } };
  }),
}));

import { sendOpsDigest } from "../email";

const ARGS = { subject: "Foundry: 2 things need you", text: "line one\nline two\n" };

describe("sendOpsDigest", () => {
  const originalKey = process.env.RESEND_API_KEY;
  const originalTo = process.env.OPS_DIGEST_TO;
  const originalFrom = process.env.OPS_DIGEST_FROM;

  beforeEach(() => {
    send.mockReset();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (originalTo === undefined) delete process.env.OPS_DIGEST_TO;
    else process.env.OPS_DIGEST_TO = originalTo;
    if (originalFrom === undefined) delete process.env.OPS_DIGEST_FROM;
    else process.env.OPS_DIGEST_FROM = originalFrom;
  });

  it("skips the send and reports undelivered when RESEND_API_KEY is unset", async () => {
    delete process.env.RESEND_API_KEY;

    const result = await sendOpsDigest(ARGS);

    expect(result).toEqual({ delivered: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("reports delivered when Resend resolves without an error", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    send.mockResolvedValue({ data: { id: "email_123" }, error: null });

    const result = await sendOpsDigest(ARGS);

    expect(result).toEqual({ delivered: true });
  });

  it("reports undelivered when Resend resolves an error (e.g. rate limit)", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    send.mockResolvedValue({
      data: null,
      error: { name: "rate_limit_exceeded", statusCode: 429, message: "Too many requests" },
    });

    const result = await sendOpsDigest(ARGS);

    expect(result).toEqual({ delivered: false });
  });

  it("reports undelivered when Resend throws", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    send.mockRejectedValue(new Error("network down"));

    const result = await sendOpsDigest(ARGS);

    expect(result).toEqual({ delivered: false });
  });

  it("defaults from/to when OPS_DIGEST_TO / OPS_DIGEST_FROM are unset", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    delete process.env.OPS_DIGEST_TO;
    delete process.env.OPS_DIGEST_FROM;
    send.mockResolvedValue({ data: { id: "email_123" }, error: null });

    await sendOpsDigest(ARGS);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Foundry Ops <alerts@foundryplanning.com>",
        to: "dan@foundryplanning.com",
        subject: ARGS.subject,
        text: ARGS.text,
      }),
    );
  });

  it("uses OPS_DIGEST_TO / OPS_DIGEST_FROM overrides when set", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.OPS_DIGEST_TO = "ops@example.com";
    process.env.OPS_DIGEST_FROM = "Custom <custom@example.com>";
    send.mockResolvedValue({ data: { id: "email_123" }, error: null });

    await sendOpsDigest(ARGS);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Custom <custom@example.com>", to: "ops@example.com" }),
    );
  });
});
