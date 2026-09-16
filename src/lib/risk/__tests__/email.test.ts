import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

const mockSend = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: mockSend } };
  }),
}));

import { sendRiskQuestionnaireEmail } from "../email";

const ARGS = {
  to: "client@example.com",
  link: "https://foundryplanning.com/risk/abc123",
};

describe("sendRiskQuestionnaireEmail", () => {
  let savedApiKey: string | undefined;

  beforeEach(() => {
    savedApiKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    mockSend.mockClear();
  });

  afterEach(() => {
    if (savedApiKey !== undefined) {
      process.env.RESEND_API_KEY = savedApiKey;
    } else {
      delete process.env.RESEND_API_KEY;
    }
  });

  it("reports undelivered when RESEND_API_KEY is not set", async () => {
    await expect(sendRiskQuestionnaireEmail(ARGS)).resolves.toEqual({
      delivered: false,
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("reports delivered once Resend accepts the send", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    mockSend.mockResolvedValueOnce({ data: { id: "re_1" }, error: null });

    await expect(sendRiskQuestionnaireEmail(ARGS)).resolves.toEqual({
      delivered: true,
    });
  });

  it("reports undelivered — never throws — when the transport throws", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    mockSend.mockRejectedValueOnce(new Error("resend is down"));

    await expect(sendRiskQuestionnaireEmail(ARGS)).resolves.toEqual({
      delivered: false,
    });
  });

  // `delivered` is not cosmetic here: the send-rtq route writes it into the
  // audit log and hands it to the UI. Resend's SDK resolves { data: null,
  // error } for every non-2xx rather than throwing, so reading only the
  // thrown path records "we sent it" against mail that was never accepted.
  it("reports undelivered when Resend RESOLVES an error instead of throwing", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    mockSend.mockResolvedValueOnce({
      data: null,
      error: { name: "validation_error", message: "Invalid `to` field." },
    });

    await expect(sendRiskQuestionnaireEmail(ARGS)).resolves.toEqual({
      delivered: false,
    });
  });
});
