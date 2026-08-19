import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Auth mocks ────────────────────────────────────────────────────────────────
vi.mock("@/lib/db-helpers", () => ({
  requireOrgAndUser: async () => ({ orgId: "firm-1", userId: "advisor-1" }),
}));

// advisor-2 owns the household; advisor-1 (requireOrgAndUser above) is the
// sender. Keeping them different is what proves each gate names its own person.
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: async () => ({
    firmId: "firm-1",
    access: "own",
    client: { id: "client-1", advisorId: "advisor-2" },
  }),
}));

// No advisor-brand row for any of this file's clients — the per-advisor
// from-name/reply-to overlay is exercised by route-email-settings.test.ts.
// Without this mock, the route's real getAdvisorProfile hits the @/db mock
// below, whose db.query is undefined and throws.
vi.mock("@/lib/branding/advisor-profile", () => ({
  getAdvisorProfile: async () => null,
}));

const portalEntitlementMock = vi.fn();
const portalForAdvisorMock = vi.fn();
vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: async () => {},
  requireClientPortalEntitlement: async () => portalEntitlementMock(),
  requireClientPortalForAdvisor: async (firmId: string, advisorId: string) =>
    portalForAdvisorMock(firmId, advisorId),
  // Enough of the real mapping for the entitlement 403 below; every other
  // error in this file is a plain Error and still falls through to 500.
  authErrorResponse: (err: unknown) =>
    err instanceof Error && err.name === "ForbiddenError"
      ? { status: 403, body: { error: err.message } }
      : undefined,
}));

vi.mock("@/lib/clients/cross-firm-audit", () => ({
  crossFirmAuditMeta: (..._a: unknown[]) => ({}),
}));

// ── Rate-limit mock ───────────────────────────────────────────────────────────
const checkLimitMock = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkPortalInviteRateLimit: (k: string) => checkLimitMock(k),
}));

// ── Clerk mock ────────────────────────────────────────────────────────────────
const createInvitationMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({
    userId: "advisor-1",
    orgId: "firm-1",
    sessionClaims: { org_name: "Acme Wealth Management" },
  }),
  currentUser: async () => ({ firstName: "Jane", lastName: "Advisor", primaryEmailAddress: { emailAddress: "jane@acme.com" } }),
  clerkClient: async () => ({
    invitations: {
      createInvitation: (args: unknown) => createInvitationMock(args),
    },
    // Firm name is resolved live from the Clerk org (not session claims).
    organizations: {
      getOrganization: async () => ({ name: "Acme Wealth Management" }),
    },
  }),
}));

// ── DB mock ───────────────────────────────────────────────────────────────────
// Configurable select result (controls client.clerkUserId lookup)
const selectClientResultMock = vi.fn();
const dbUpdateMock = vi.fn();
const dbInsertMock = vi.fn();

vi.mock("@/db", () => ({
  db: {
    insert: (_table: unknown) => ({
      values: (_vals: unknown) => ({
        returning: (_cols: unknown) => dbInsertMock(_vals),
      }),
    }),
    select: (_cols: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => selectClientResultMock(),
      }),
    }),
    update: (_table: unknown) => ({
      set: (vals: unknown) => ({
        where: (_cond: unknown) => dbUpdateMock(vals),
      }),
    }),
  },
}));

// ── Email mock ────────────────────────────────────────────────────────────────
const sendIntakeFormEmailMock = vi.fn();
vi.mock("@/lib/intake/email", () => ({
  sendIntakeFormEmail: (args: unknown) => sendIntakeFormEmailMock(args),
}));

// ── Token mock (stable values for assertions) ─────────────────────────────────
vi.mock("@/lib/intake/tokens", () => ({
  newIntakeToken: () => "test-token-abc",
  defaultExpiry: (now: Date) => new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
}));

// ── Audit mock ────────────────────────────────────────────────────────────────
const recordAuditMock = vi.fn();
vi.mock("@/lib/audit", () => ({
  recordAudit: (args: unknown) => recordAuditMock(args),
}));

import { POST } from "@/app/api/data-collection/route";

// ── Helpers ───────────────────────────────────────────────────────────────────
function postReq(body: unknown) {
  return new Request("http://localhost/api/data-collection", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  checkLimitMock.mockReset();
  createInvitationMock.mockReset();
  dbInsertMock.mockReset();
  dbUpdateMock.mockReset();
  selectClientResultMock.mockReset();
  sendIntakeFormEmailMock.mockReset();
  recordAuditMock.mockReset();
  portalEntitlementMock.mockReset();
  portalForAdvisorMock.mockReset();

  // Happy-path defaults
  checkLimitMock.mockResolvedValue({ allowed: true });
  dbInsertMock.mockResolvedValue([{ id: "form-1" }]);
  selectClientResultMock.mockResolvedValue([{ clerkUserId: null }]); // unbound client
  createInvitationMock.mockResolvedValue({ id: "inv_1" });
  dbUpdateMock.mockResolvedValue(undefined);
  sendIntakeFormEmailMock.mockResolvedValue(undefined);
  recordAuditMock.mockResolvedValue(undefined);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/data-collection — input validation", () => {
  it("rejects missing/invalid mode", async () => {
    const res = await POST(postReq({ mode: "foobar", recipientEmail: "a@b.com" }));
    expect(res.status).toBe(400);
  });

  it("rejects invalid email", async () => {
    const res = await POST(postReq({ mode: "blank", recipientEmail: "not-an-email" }));
    expect(res.status).toBe(400);
  });

  it("rejects prefilled without clientId", async () => {
    const res = await POST(postReq({ mode: "prefilled", recipientEmail: "a@b.com" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/clientId/i);
  });
});

describe("POST /api/data-collection — blank mode with clientId", () => {
  it("inserts form row with mode blank, clientId set, sentAt present; calls sendIntakeFormEmail; audits intake.form.sent", async () => {
    const res = await POST(
      postReq({
        mode: "blank",
        clientId: "client-1",
        recipientEmail: "prospect@example.com",
        recipientName: "Smith Family",
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.formId).toBe("form-1");
    expect(json.token).toBe("test-token-abc");

    // Form inserted with correct fields
    expect(dbInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "blank",
        clientId: "client-1",
        firmId: "firm-1",
        token: "test-token-abc",
        recipientEmail: "prospect@example.com",
        recipientName: "Smith Family",
        createdByUserId: "advisor-1",
        sentAt: expect.any(Date),
        expiresAt: expect.any(Date),
      }),
    );

    // Email sent with correct link + advisor/firm names. The per-advisor
    // settings pass-through (fromName/subject/introBody) is asserted in
    // route-email-settings.test.ts, which mocks a real intakeEmailSettings
    // row; this suite's shared select mock returns a client-shaped row.
    expect(sendIntakeFormEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "prospect@example.com",
        link: expect.stringContaining("/intake/test-token-abc"),
        firmName: "Acme Wealth Management",
        advisorName: "Jane Advisor",
        advisorEmail: "jane@acme.com",
        clientName: "Smith Family",
      }),
    );

    // No invite
    expect(createInvitationMock).not.toHaveBeenCalled();

    // Audit
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "intake.form.sent",
        resourceType: "intake_form",
        resourceId: "form-1",
        clientId: "client-1",
        firmId: "firm-1",
      }),
    );
  });
});

describe("POST /api/data-collection — blank mode, no clientId (prospect)", () => {
  it("inserts form with clientId null and firmId from orgId; sends email", async () => {
    const res = await POST(
      postReq({
        mode: "blank",
        recipientEmail: "prospect@example.com",
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    // clientId null, firmId = orgId ("firm-1" from requireOrgAndUser mock)
    expect(dbInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "blank",
        clientId: null,
        firmId: "firm-1",
      }),
    );

    expect(sendIntakeFormEmailMock).toHaveBeenCalled();
    expect(createInvitationMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/data-collection — prefilled mode, unbound client", () => {
  it("inserts form, sends portal invite via createInvitation, returns invitationId", async () => {
    // Client has no clerkUserId (unbound)
    selectClientResultMock.mockResolvedValue([{ clerkUserId: null }]);

    const res = await POST(
      postReq({
        mode: "prefilled",
        clientId: "client-1",
        recipientEmail: "client@example.com",
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.invitationId).toBe("inv_1");

    // Form inserted with mode prefilled
    expect(dbInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "prefilled",
        clientId: "client-1",
      }),
    );

    // Clerk invite created
    expect(createInvitationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        emailAddress: "client@example.com",
        publicMetadata: { clientId: "client-1" },
      }),
    );

    // portalInvitedAt stamped
    expect(dbUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ portalInvitedAt: expect.any(Date) }),
    );

    // Audit
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "intake.form.sent", clientId: "client-1" }),
    );
  });
});

describe("POST /api/data-collection — prefilled mode, already-bound client", () => {
  it("inserts form but skips the portal invite when clerkUserId is set", async () => {
    // Client is already bound
    selectClientResultMock.mockResolvedValue([{ clerkUserId: "user_clerk_123" }]);

    const res = await POST(
      postReq({
        mode: "prefilled",
        clientId: "client-1",
        recipientEmail: "client@example.com",
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    // No invitationId since we skipped
    expect(json.invitationId).toBeUndefined();

    expect(dbInsertMock).toHaveBeenCalled();
    // No Clerk call
    expect(createInvitationMock).not.toHaveBeenCalled();
    // Audit still fires
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "intake.form.sent" }),
    );
  });
});

describe("POST /api/data-collection — sections", () => {
  const insertValues = () =>
    dbInsertMock.mock.calls[0][0] as Record<string, unknown>;

  it("stores null when the caller sends no sections", async () => {
    await POST(postReq({ mode: "blank", recipientEmail: "a@b.com" }));
    expect(insertValues().sections).toBeNull();
  });

  it("forces family into a prospect send that omitted it", async () => {
    await POST(
      postReq({ mode: "blank", recipientEmail: "a@b.com", sections: ["documents"] }),
    );
    expect(insertValues().sections).toEqual(["family", "documents"]);
  });

  it("does not force family on an existing-client send", async () => {
    await POST(
      postReq({
        mode: "blank",
        clientId: "client-1",
        recipientEmail: "a@b.com",
        sections: ["documents"],
      }),
    );
    expect(insertValues().sections).toEqual(["documents"]);
  });

  it("stores canonical order regardless of the order sent", async () => {
    await POST(
      postReq({
        mode: "blank",
        clientId: "client-1",
        recipientEmail: "a@b.com",
        sections: ["risk", "family"],
      }),
    );
    expect(insertValues().sections).toEqual(["family", "risk"]);
  });

  it("rejects a set that collects nothing, before any row is written", async () => {
    const res = await POST(
      postReq({
        mode: "blank",
        clientId: "client-1",
        recipientEmail: "a@b.com",
        sections: ["nope"],
      }),
    );
    expect(res.status).toBe(400);
    expect(dbInsertMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/data-collection — a prefilled send has to be renderable in the portal", () => {
  it("rejects a documents-only prefilled send, before the form row and before the invite", async () => {
    // Prefilled is delivered as a portal invite and nothing else. The portal
    // wizard has no upload surface, so this form would render nothing, bounce
    // the client to the Organizer, and sit in draft forever unmentioned.
    const res = await POST(
      postReq({
        mode: "prefilled",
        clientId: "client-1",
        recipientEmail: "a@b.com",
        sections: ["documents"],
      }),
    );
    expect(res.status).toBe(400);
    expect(dbInsertMock).not.toHaveBeenCalled();
    expect(createInvitationMock).not.toHaveBeenCalled();
  });

  it("accepts the same documents-only set on a blank send — that one is an emailed token link", async () => {
    const res = await POST(
      postReq({
        mode: "blank",
        clientId: "client-1",
        recipientEmail: "a@b.com",
        sections: ["documents"],
      }),
    );
    expect(res.status).toBe(200);
    expect(dbInsertMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ sections: ["documents"] }),
    );
  });

  it("accepts a prefilled send that pairs documents with a step the portal can render", async () => {
    const res = await POST(
      postReq({
        mode: "prefilled",
        clientId: "client-1",
        recipientEmail: "a@b.com",
        sections: ["documents", "goals"],
      }),
    );
    expect(res.status).toBe(200);
    expect(dbInsertMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ sections: ["goals", "documents"] }),
    );
  });
});

describe("POST /api/data-collection — client_portal entitlement", () => {
  /** A ForbiddenError as thrown by the real portal gates. */
  function forbidden() {
    const err = new Error("Client portal is not enabled");
    err.name = "ForbiddenError";
    return err;
  }
  function forbid() {
    portalEntitlementMock.mockImplementation(() => {
      throw forbidden();
    });
  }

  it("403s a prefilled send when the firm has no client portal, storing nothing", async () => {
    forbid();
    const res = await POST(
      postReq({
        mode: "prefilled",
        clientId: "client-1",
        recipientEmail: "client@example.com",
      }),
    );
    expect(res.status).toBe(403);
    expect(dbInsertMock).not.toHaveBeenCalled();
    expect(createInvitationMock).not.toHaveBeenCalled();
  });

  it("asks the portal question about the HOUSEHOLD'S advisor, not the sender", async () => {
    const res = await POST(
      postReq({
        mode: "prefilled",
        clientId: "client-1",
        recipientEmail: "client@example.com",
      }),
    );
    expect(res.status).toBe(200);
    // Sign-in resolves against clients.advisor_id, so advisor-2 — not the
    // sending advisor-1 — is the one whose entitlement decides.
    expect(portalForAdvisorMock).toHaveBeenCalledWith("firm-1", "advisor-2");
  });

  it("403s a prefilled send when the household's advisor is revoked, though the sender is entitled", async () => {
    portalForAdvisorMock.mockImplementation(() => {
      throw forbidden();
    });
    const res = await POST(
      postReq({
        mode: "prefilled",
        clientId: "client-1",
        recipientEmail: "client@example.com",
      }),
    );
    expect(res.status).toBe(403);
    expect(portalEntitlementMock).toHaveBeenCalled();
    expect(dbInsertMock).not.toHaveBeenCalled();
    expect(createInvitationMock).not.toHaveBeenCalled();
  });

  it("still sends a blank form — a tokenized email link needs no portal", async () => {
    forbid();
    const res = await POST(
      postReq({ mode: "blank", clientId: "client-1", recipientEmail: "a@b.com" }),
    );
    expect(res.status).toBe(200);
    expect(portalEntitlementMock).not.toHaveBeenCalled();
    expect(portalForAdvisorMock).not.toHaveBeenCalled();
    expect(sendIntakeFormEmailMock).toHaveBeenCalled();
  });
});

describe("POST /api/data-collection — rate limiting", () => {
  it("returns 429 when rate-limited on prefilled", async () => {
    checkLimitMock.mockResolvedValue({ allowed: false, reason: "too many invites" });

    const res = await POST(
      postReq({
        mode: "prefilled",
        clientId: "client-1",
        recipientEmail: "client@example.com",
      }),
    );

    expect(res.status).toBe(429);
    expect(dbInsertMock).not.toHaveBeenCalled();
  });

  it("does NOT rate-limit blank mode", async () => {
    // Even if the rate limiter would deny, blank mode doesn't call it
    checkLimitMock.mockResolvedValue({ allowed: false, reason: "exceeded" });

    const res = await POST(
      postReq({ mode: "blank", recipientEmail: "a@b.com" }),
    );

    // checkLimitMock not called at all for blank
    expect(checkLimitMock).not.toHaveBeenCalled();
    // And the request succeeds
    expect(res.status).toBe(200);
  });
});
