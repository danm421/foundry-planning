import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send } };
  }),
}));

const recordAuditMock = vi.fn();
vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => recordAuditMock(a) }));

// Spread the REAL module so PORTAL_ACCESS_REQUEST_SUBJECT stays the shipped
// constant (the subject assertion below would be a tautology against a stubbed
// one) and only the HTML builder is steerable.
const buildHtmlMock = vi.fn();
vi.mock("@/lib/clients/portal-access-request-email", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/clients/portal-access-request-email")>();
  return {
    ...actual,
    buildPortalAccessRequestEmailHtml: (a: { link: string }) => buildHtmlMock(a),
  };
});

import { sendPortalAccessRequest } from "../send-portal-access-request";

const ARGS = {
  to: "jane@example.com",
  clientId: "c1",
  bindingId: "binding-1",
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
  send.mockResolvedValue({ data: { id: "email_1" }, error: null });
  buildHtmlMock.mockReturnValue("<html>request</html>");
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalKey;
});

describe("sendPortalAccessRequest", () => {
  it("always sends from the hardcoded Foundry address, never a white-labelled firm name", async () => {
    // A "firm-1" caller org that just happens to share a name-like value with
    // a real firm is enough to catch a future edit that routes firmName (or
    // any per-request value) into the From header the way the sibling mailer
    // does. Asserting the literal value — not re-importing a constant from
    // the module under test — is what would actually fail if someone "fixed"
    // this file to match send-portal-signin-link.ts's buildIntakeFromHeader
    // pattern.
    await sendPortalAccessRequest(ARGS);

    const sent = send.mock.calls[0][0];
    expect(sent.from).toBe("Foundry Planning <noreply@foundryplanning.com>");
    expect(sent.from).not.toMatch(/firm/i);
  });

  it("links to /requests — NOT a path under /portal", async () => {
    // The accept/decline screen cannot live under (portal): both layouts there
    // call requireClientPortalAccess(), which throws for a login with no
    // binding — every first-time recipient of this email. A link back under
    // /portal would 403 exactly the population this mail exists for, and the
    // failure is invisible from this module's own tests unless pinned here.
    await sendPortalAccessRequest(ARGS);

    const { link } = buildHtmlMock.mock.calls[0][0];
    expect(new URL(link).pathname).toBe("/requests");
  });

  it("delivers to the given address with the content-free subject", async () => {
    await sendPortalAccessRequest(ARGS);

    const sent = send.mock.calls[0][0];
    expect(sent.to).toBe("jane@example.com");
    expect(sent.subject).toBe("You have a pending connection request on Foundry Planning");
  });

  it("audits the send only after a successful delivery", async () => {
    const result = await sendPortalAccessRequest(ARGS);

    expect(result).toEqual({ delivered: true });
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "portal.access.requested",
        resourceType: "portal_binding",
        resourceId: "binding-1",
        clientId: "c1",
        firmId: "firm-1",
      }),
    );
  });

  it("reports unconfigured and never calls Resend or audits when RESEND_API_KEY is unset", async () => {
    delete process.env.RESEND_API_KEY;

    const result = await sendPortalAccessRequest(ARGS);

    expect(result).toEqual({ delivered: false, reason: "unconfigured" });
    expect(send).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("reports send_failed and does not audit when Resend returns an error", async () => {
    send.mockResolvedValue({ data: null, error: { message: "domain not verified" } });

    const result = await sendPortalAccessRequest(ARGS);

    expect(result).toEqual({ delivered: false, reason: "send_failed" });
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("reports send_failed and does not audit when the Resend call throws", async () => {
    send.mockRejectedValue(new Error("network down"));

    const result = await sendPortalAccessRequest(ARGS);

    expect(result).toEqual({ delivered: false, reason: "send_failed" });
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  // The { delivered, reason } contract is what the invite route branches on to
  // undo its pending row. A throw from ANY part of this function escapes that
  // branch, so the row is stranded and every retry is refused as already_live
  // for the full request TTL — the exact state the hard delete exists to
  // prevent. Building the email body is inside the guard for that reason.
  it("reports send_failed rather than throwing when the email body cannot be built", async () => {
    buildHtmlMock.mockImplementation(() => {
      throw new Error("template blew up");
    });

    const result = await sendPortalAccessRequest(ARGS);

    expect(result).toEqual({ delivered: false, reason: "send_failed" });
    expect(send).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });
});
