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
// update → the reopen write; select → the client row `resolveFormLink` reads.
const updateMock = vi.fn();
const selectClientMock = vi.fn();
vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (vals: unknown) => ({
        where: () => ({
          returning: () => updateMock(vals),
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => selectClientMock(),
      }),
    }),
  },
}));

const loadFormMock = vi.fn();
vi.mock("@/lib/intake/form-access", () => ({
  loadFormForCaller: (id: string, firmId: string) => loadFormMock(id, firmId),
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

const recordAuditMock = vi.fn();
vi.mock("@/lib/audit", () => ({
  recordAudit: (args: unknown) => recordAuditMock(args),
}));

import { POST } from "@/app/api/data-collection/[id]/reopen/route";

// ── Helpers ───────────────────────────────────────────────────────────────────
function postReq() {
  return new Request("http://localhost/api/data-collection/form-1/reopen", {
    method: "POST",
  });
}

const ctx = { params: Promise.resolve({ id: "form-1" }) };

function form(overrides: Record<string, unknown> = {}) {
  return {
    id: "form-1",
    firmId: "firm-1",
    clientId: null,
    mode: "blank",
    status: "submitted",
    token: "tok-abc",
    recipientEmail: "sam@client.com",
    recipientName: "Sam Client",
    // Nearly lapsed — reopening must not hand the client a link that dies tomorrow.
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    submittedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  loadFormMock.mockReset().mockResolvedValue(form());
  updateMock.mockReset().mockResolvedValue([{ id: "form-1" }]);
  selectClientMock.mockReset().mockResolvedValue([]);
  sendMock.mockReset().mockResolvedValue({ delivered: true });
  resolveBindingMock.mockReset().mockResolvedValue(null);
  recordAuditMock.mockReset().mockResolvedValue(undefined);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/data-collection/[id]/reopen", () => {
  it("returns a submitted form to draft with its answers, a fresh expiry, and audits it", async () => {
    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, delivered: true });

    const vals = updateMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(vals.status).toBe("draft");
    expect(vals.submittedAt).toBeNull();
    // The payload is never touched — the client picks up their own answers.
    expect(vals).not.toHaveProperty("payload");
    const days = ((vals.expiresAt as Date).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29);

    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "intake.form.reopened",
        resourceType: "intake_form",
        resourceId: "form-1",
        firmId: "firm-1",
      }),
    );
  });

  it("emails a blank form's own token link with the reopened wording", async () => {
    await POST(postReq(), ctx);
    const arg = sendMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.link).toContain("/intake/tok-abc");
    expect(arg.to).toBe("sam@client.com");
    expect(arg.followUp).toBe("reopened");
  });

  it("points a pre-filled form at the portal when the client has a login", async () => {
    loadFormMock.mockResolvedValue(form({ mode: "prefilled", clientId: "client-1" }));
    selectClientMock.mockResolvedValue([{ advisorId: "owner-1", clerkUserId: null }]);
    resolveBindingMock.mockResolvedValue("user_portal");

    await POST(postReq(), ctx);
    const arg = sendMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.link).toMatch(/\/portal\/intake$/);
    expect(arg.brandAdvisorUserId).toBe("owner-1");
  });

  it("still reopens when there is no login to mail, and says nothing was delivered", async () => {
    loadFormMock.mockResolvedValue(form({ mode: "prefilled", clientId: "client-1" }));

    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, delivered: false });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("still reopens when the mail fails, and says nothing was delivered", async () => {
    sendMock.mockResolvedValue({ delivered: false, reason: "send_failed" });

    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, delivered: false });
  });

  it.each([
    ["applied", /already in the plan/],
    ["draft", /already open/],
    ["discarded", /discarded/],
  ])("refuses a %s form with 409 and writes nothing", async (status, message) => {
    loadFormMock.mockResolvedValue(form({ status }));

    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(message);
    expect(updateMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("409s without mailing when the form left `submitted` between read and write", async () => {
    // An Apply in another tab landed first: the guarded update matches no row.
    updateMock.mockResolvedValue([]);

    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(409);
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("404s a form outside the caller's firm", async () => {
    loadFormMock.mockResolvedValue(null);

    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
