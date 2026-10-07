import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Auth mocks ────────────────────────────────────────────────────────────────
vi.mock("@/lib/db-helpers", () => ({
  requireOrgAndUser: async () => ({ orgId: "firm-1", userId: "advisor-1" }),
}));

// Import the real module so we get the genuine ForbiddenError class — this is
// what makes the authErrorResponse instanceof check faithful to production
// (a plain Error would map to 500, not 403; see the Task 4.1 masking defect).
const requireActiveSubscriptionForFirmMock = vi.fn();
vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return {
    ...actual,
    requireActiveSubscriptionForFirm: (firmId: string) =>
      requireActiveSubscriptionForFirmMock(firmId),
    // Faithful instanceof-based mapping (mirrors the real impl) so ForbiddenError
    // → 403; avoids pulling UnauthorizedError from the mocked @/lib/db-helpers.
    authErrorResponse: (e: unknown) =>
      e instanceof actual.ForbiddenError
        ? { status: 403 as const, body: { error: (e as Error).message } }
        : null,
  };
});

// ── DB mock ───────────────────────────────────────────────────────────────────
const dbSelectMock = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => dbSelectMock(),
        }),
      }),
    }),
  },
}));

// ── loadFormForCaller mock ────────────────────────────────────────────────────
const loadFormMock = vi.fn();
vi.mock("@/lib/intake/form-access", () => ({
  loadFormForCaller: (id: string, firmId: string) => loadFormMock(id, firmId),
}));

// ── applyIntake mock ──────────────────────────────────────────────────────────
const applyIntakeMock = vi.fn();
vi.mock("@/lib/intake/apply", () => ({
  applyIntake: (args: unknown) => applyIntakeMock(args),
}));

// ── Link-to-existing-client mocks ─────────────────────────────────────────────
const requireClientEditAccessMock = vi.fn();
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: (id: string) => requireClientEditAccessMock(id),
}));
const linkMock = vi.fn();
vi.mock("@/lib/intake/link-client", () => ({
  linkIntakeFormToClient: (args: unknown) => linkMock(args),
}));

import { POST } from "@/app/api/data-collection/[id]/apply/route";
import { ForbiddenError } from "@/lib/authz";

// ── Helpers ───────────────────────────────────────────────────────────────────
function postReq() {
  return new Request("http://localhost/api/data-collection/form-1/apply", {
    method: "POST",
  });
}

function linkReq(clientId: unknown) {
  return new Request("http://localhost/api/data-collection/form-1/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId }),
  });
}
const EXISTING = "7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";

const ctx = { params: Promise.resolve({ id: "form-1" }) };
const crossFirmCtx = { params: Promise.resolve({ id: "cross-firm-form" }) };

beforeEach(() => {
  loadFormMock.mockReset();
  applyIntakeMock.mockReset();
  requireActiveSubscriptionForFirmMock.mockReset();
  requireActiveSubscriptionForFirmMock.mockResolvedValue(undefined);

  // Happy-path default: submitted form
  loadFormMock.mockResolvedValue({
    id: "form-1",
    firmId: "firm-1",
    status: "submitted",
    clientId: null,
  });
  applyIntakeMock.mockResolvedValue({ clientId: "client-new-1" });
  requireClientEditAccessMock.mockReset();
  requireClientEditAccessMock.mockResolvedValue({});
  linkMock.mockReset();
  linkMock.mockResolvedValue("linked");
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/data-collection/[id]/apply", () => {
  it("calls applyIntake with correct args and returns {ok:true, clientId}", async () => {
    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.clientId).toBe("client-new-1");

    expect(applyIntakeMock).toHaveBeenCalledWith({
      formId: "form-1",
      firmId: "firm-1",
      actorId: "advisor-1",
    });
  });

  it("returns 404 when loadFormForCaller returns null (missing, other firm or other book)", async () => {
    loadFormMock.mockResolvedValue(null);
    const res = await POST(postReq(), crossFirmCtx);
    expect(res.status).toBe(404);
    expect(applyIntakeMock).not.toHaveBeenCalled();
  });

  it("delegates scoping to loadFormForCaller (passes orgId as firmId)", async () => {
    await POST(postReq(), ctx);
    expect(loadFormMock).toHaveBeenCalledWith("form-1", "firm-1");
  });

  it("returns 403 (not 500) when the firm has no active subscription, without applying", async () => {
    requireActiveSubscriptionForFirmMock.mockRejectedValue(
      new ForbiddenError("Active subscription required"),
    );
    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(403);
    expect(applyIntakeMock).not.toHaveBeenCalled();
    // Gate runs before the form load — a lapsed firm never reaches the DB.
    expect(loadFormMock).not.toHaveBeenCalled();
  });

  it("never links when no clientId is sent", async () => {
    await POST(postReq(), ctx);
    expect(linkMock).not.toHaveBeenCalled();
  });

  describe("with a clientId (link to an existing client)", () => {
    it("checks edit access, links, then applies", async () => {
      applyIntakeMock.mockResolvedValue({ clientId: EXISTING });
      const res = await POST(linkReq(EXISTING), ctx);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, clientId: EXISTING });
      expect(requireClientEditAccessMock).toHaveBeenCalledWith(EXISTING);
      expect(linkMock).toHaveBeenCalledWith({
        formId: "form-1",
        firmId: "firm-1",
        clientId: EXISTING,
        actorId: "advisor-1",
      });
      expect(linkMock.mock.invocationCallOrder[0]).toBeLessThan(
        applyIntakeMock.mock.invocationCallOrder[0],
      );
    });

    it("400s on a malformed id before touching anything", async () => {
      const res = await POST(linkReq("not-a-uuid"), ctx);
      expect(res.status).toBe(400);
      expect(requireClientEditAccessMock).not.toHaveBeenCalled();
      expect(applyIntakeMock).not.toHaveBeenCalled();
    });

    it("403s for a client the advisor can't edit, without linking", async () => {
      requireClientEditAccessMock.mockRejectedValue(new ForbiddenError("Edit access required"));
      const res = await POST(linkReq(EXISTING), ctx);
      expect(res.status).toBe(403);
      expect(linkMock).not.toHaveBeenCalled();
      expect(applyIntakeMock).not.toHaveBeenCalled();
    });

    it("409s when the form can't be linked, and does not apply it", async () => {
      linkMock.mockResolvedValue("conflict");
      const res = await POST(linkReq(EXISTING), ctx);
      expect(res.status).toBe(409);
      expect(applyIntakeMock).not.toHaveBeenCalled();
    });

    it("404s when the client isn't in this firm", async () => {
      linkMock.mockResolvedValue("client_not_found");
      const res = await POST(linkReq(EXISTING), ctx);
      expect(res.status).toBe(404);
      expect(applyIntakeMock).not.toHaveBeenCalled();
    });
  });
});
