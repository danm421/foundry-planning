import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Auth mocks ────────────────────────────────────────────────────────────────
vi.mock("@/lib/db-helpers", () => ({
  requireOrgAndUser: async () => ({ orgId: "firm-1", userId: "advisor-1" }),
}));

vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: async () => {},
  authErrorResponse: () => undefined,
}));

// ── DB mock ───────────────────────────────────────────────────────────────────
// Only ever reached for the client row behind a form that carries a clientId.
const selectClientMock = vi.fn();
vi.mock("@/db", () => ({
  db: {
    select: (_cols: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => selectClientMock(),
      }),
    }),
  },
}));

const loadFormForFirmMock = vi.fn();
vi.mock("@/lib/intake/queries", () => ({
  loadFormForFirm: (id: string, firmId: string) => loadFormForFirmMock(id, firmId),
}));

const sendMock = vi.fn();
vi.mock("@/lib/intake/send-form-email", () => ({
  sendIntakeLinkEmail: (args: unknown) => sendMock(args),
}));

const resolveBindingMock = vi.fn();
vi.mock("@/lib/portal/bindings", () => ({
  resolveClientPortalUserId: (clientId: string, legacy: string | null) =>
    resolveBindingMock(clientId, legacy),
}));

const rateLimitMock = vi.fn();
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    // The 429/503 mapping and Retry-After math are the real thing — only the
    // Redis round-trip is stubbed.
    rateLimitErrorResponse: actual.rateLimitErrorResponse,
    checkIntakeRemindRateLimit: (key: string) => rateLimitMock(key),
  };
});

const recordAuditMock = vi.fn();
vi.mock("@/lib/audit", () => ({
  recordAudit: (args: unknown) => recordAuditMock(args),
}));

import { POST } from "@/app/api/data-collection/[id]/remind/route";

// ── Helpers ───────────────────────────────────────────────────────────────────
function postReq() {
  return new Request("http://localhost/api/data-collection/form-1/remind", {
    method: "POST",
  });
}

const ctx = { params: Promise.resolve({ id: "form-1" }) };

const FAR_FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

function form(overrides: Record<string, unknown> = {}) {
  return {
    id: "form-1",
    firmId: "firm-1",
    clientId: null,
    mode: "blank",
    status: "draft",
    token: "tok-abc",
    recipientEmail: "sam@client.com",
    recipientName: "Sam Client",
    expiresAt: FAR_FUTURE,
    ...overrides,
  };
}

beforeEach(() => {
  loadFormForFirmMock.mockReset().mockResolvedValue(form());
  sendMock.mockReset().mockResolvedValue({ delivered: true });
  selectClientMock.mockReset().mockResolvedValue([]);
  resolveBindingMock.mockReset().mockResolvedValue(null);
  rateLimitMock.mockReset().mockResolvedValue({ allowed: true, remaining: 2, reset: 0 });
  recordAuditMock.mockReset().mockResolvedValue(undefined);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/data-collection/[id]/remind", () => {
  it("mails the form's OWN token link again and audits the nudge", async () => {
    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0]![0] as Record<string, unknown>;
    // The same token, not a fresh one: a re-keyed link would kill the copy the
    // client may already have open.
    expect(arg.link).toContain("/intake/tok-abc");
    expect(arg.to).toBe("sam@client.com");
    expect(arg.reminder).toBe(true);

    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "intake.form.reminded",
        resourceType: "intake_form",
        resourceId: "form-1",
        clientId: null,
        firmId: "firm-1",
      }),
    );
  });

  it("returns 404 for a form in another firm", async () => {
    loadFormForFirmMock.mockResolvedValue(null);
    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(404);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it.each(["submitted", "applied", "discarded", "expired"])(
    "refuses to chase the client over a %s form",
    async (status) => {
      loadFormForFirmMock.mockResolvedValue(form({ status }));
      const res = await POST(postReq(), ctx);
      expect(res.status).toBe(409);
      expect(sendMock).not.toHaveBeenCalled();
      expect(recordAuditMock).not.toHaveBeenCalled();
    },
  );

  it("refuses a draft whose link has already expired", async () => {
    loadFormForFirmMock.mockResolvedValue(
      form({ expiresAt: new Date(Date.now() - 1000) }),
    );
    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/expired/i);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns 429 when the per-form reminder budget is spent", async () => {
    rateLimitMock.mockResolvedValue({ allowed: false, reason: "exceeded", reset: Date.now() + 5000 });
    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(429);
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("buckets the limit on the FORM, so one chased client can't spend another's budget", async () => {
    await POST(postReq(), ctx);
    expect(rateLimitMock).toHaveBeenCalledWith("form-1");
  });

  it("points a prefilled form at the portal once the client has a login", async () => {
    loadFormForFirmMock.mockResolvedValue(form({ mode: "prefilled", clientId: "client-1" }));
    selectClientMock.mockResolvedValue([{ advisorId: "advisor-2", clerkUserId: null }]);
    resolveBindingMock.mockResolvedValue("user_clerk_1");

    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(200);
    const arg = sendMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.link).toContain("/portal/intake");
    // The token never travels for a prefilled form — the portal login is the door.
    expect(arg.link).not.toContain("tok-abc");
    // Brand follows the household's advisor, not whoever clicked Remind.
    expect(arg.brandAdvisorUserId).toBe("advisor-2");
  });

  it("sends nothing for a prefilled form whose client has no login yet", async () => {
    loadFormForFirmMock.mockResolvedValue(form({ mode: "prefilled", clientId: "client-1" }));
    selectClientMock.mockResolvedValue([{ advisorId: "advisor-2", clerkUserId: null }]);
    resolveBindingMock.mockResolvedValue(null);

    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/access tab/i);
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("reports 502 and audits NOTHING when the mail never left", async () => {
    sendMock.mockResolvedValue({ delivered: false, reason: "send_failed" });
    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(502);
    // The queue reads reminder audits back as "Reminded <date>" — a row here
    // would tell the advisor they chased someone they hadn't.
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("names the missing email config rather than blaming the send", async () => {
    sendMock.mockResolvedValue({ delivered: false, reason: "unconfigured" });
    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/isn't configured/i);
  });
});
