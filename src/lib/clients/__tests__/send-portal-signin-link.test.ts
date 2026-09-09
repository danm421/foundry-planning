import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send } };
  }),
}));

const createSignInTokenMock = vi.fn();
const revokeSignInTokenMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    signInTokens: {
      createSignInToken: (a: unknown) => createSignInTokenMock(a),
      revokeSignInToken: (id: string) => revokeSignInTokenMock(id),
    },
  }),
}));

const recordAuditMock = vi.fn();
vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => recordAuditMock(a) }));

import {
  buildSignInIntro,
  sendPortalSignInLink,
  SIGNIN_LINK_TTL_SECONDS,
} from "../send-portal-signin-link";

const ARGS = {
  clientId: "c1",
  clerkUserId: "user_xyz",
  email: "jane@example.com",
  clientName: "Jane Whitfield",
  advisorName: "Dana Advisor",
  firmName: "Summit Advisory",
  firmId: "firm-1",
  callerOrg: "firm-1",
  access: "own" as const,
};

const originalKey = process.env.RESEND_API_KEY;

beforeEach(() => {
  // clearAllMocks, not resetAllMocks: the Resend constructor's implementation
  // lives in the module factory, and a reset would strip it for every test.
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test_key";
  createSignInTokenMock.mockResolvedValue({ id: "sit_1", token: "tok/with+chars" });
  send.mockResolvedValue({ data: { id: "email_1" }, error: null });
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalKey;
});

describe("sendPortalSignInLink", () => {
  it("mints a short-lived token and mails the ticket link", async () => {
    const result = await sendPortalSignInLink(ARGS);

    expect(result).toEqual({ delivered: true });
    expect(createSignInTokenMock).toHaveBeenCalledWith({
      userId: "user_xyz",
      expiresInSeconds: SIGNIN_LINK_TTL_SECONDS,
    });
    const html = send.mock.calls[0][0].html as string;
    // URL-encoded, not raw: a Clerk token can contain "+" and "/", which a bare
    // query string would mangle into a ticket Clerk rejects.
    expect(html).toContain("__clerk_ticket=tok%2Fwith%2Bchars");
    expect(send.mock.calls[0][0].to).toBe("jane@example.com");
  });

  it("wears the firm's branding, not Foundry's, for a white-labelled firm", async () => {
    await sendPortalSignInLink(ARGS);

    const sent = send.mock.calls[0][0];
    expect(sent.from).toContain("Summit Advisory");
    expect(sent.html).toContain("Summit Advisory");
    expect(sent.html).toContain("Hello Jane Whitfield,");
  });

  it("names the button after what the link opens, not the intake form", async () => {
    await sendPortalSignInLink(ARGS);

    const html = send.mock.calls[0][0].html as string;
    expect(html).toContain("Sign in to my portal");
    expect(html).not.toContain("Open My Form");
  });

  it("audits the send without ever writing the token into the log", async () => {
    await sendPortalSignInLink(ARGS);

    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "portal.signin_link.sent",
        clientId: "c1",
        firmId: "firm-1",
      }),
    );
    expect(JSON.stringify(recordAuditMock.mock.calls[0][0])).not.toContain("tok/with");
  });

  it("revokes the token and reports failure when Resend rejects the send", async () => {
    send.mockResolvedValue({ data: null, error: { message: "domain not verified" } });

    const result = await sendPortalSignInLink(ARGS);

    expect(result).toEqual({ delivered: false, reason: "send_failed" });
    // A live credential must not survive an email nobody received.
    expect(revokeSignInTokenMock).toHaveBeenCalledWith("sit_1");
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("revokes the token and reports failure when email is not configured", async () => {
    delete process.env.RESEND_API_KEY;

    const result = await sendPortalSignInLink(ARGS);

    expect(result).toEqual({ delivered: false, reason: "unconfigured" });
    expect(send).not.toHaveBeenCalled();
    expect(revokeSignInTokenMock).toHaveBeenCalledWith("sit_1");
    expect(recordAuditMock).not.toHaveBeenCalled();
  });
});

describe("buildSignInIntro", () => {
  it("states the real expiry window rather than a hardcoded hour", () => {
    expect(buildSignInIntro(3600)).toContain("within the next hour");
    expect(buildSignInIntro(3600 * 6)).toContain("within the next 6 hours");
  });

  it("leaves the advisor token for the template to substitute and escape", () => {
    expect(buildSignInIntro()).toContain("{{advisorName}}");
  });

  it("tells the client how to set a new password once they are in", () => {
    expect(buildSignInIntro()).toMatch(/set a new password/i);
  });
});
