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

// ── loadFormForFirm mock ──────────────────────────────────────────────────────
const loadFormForFirmMock = vi.fn();
vi.mock("@/lib/intake/queries", () => ({
  loadFormForFirm: (id: string, firmId: string) => loadFormForFirmMock(id, firmId),
}));

// ── applyIntake mock ──────────────────────────────────────────────────────────
const applyIntakeMock = vi.fn();
vi.mock("@/lib/intake/apply", () => ({
  applyIntake: (args: unknown) => applyIntakeMock(args),
}));

import { POST } from "@/app/api/data-collection/[id]/apply/route";
import { ForbiddenError } from "@/lib/authz";

// ── Helpers ───────────────────────────────────────────────────────────────────
function postReq() {
  return new Request("http://localhost/api/data-collection/form-1/apply", {
    method: "POST",
  });
}

const ctx = { params: Promise.resolve({ id: "form-1" }) };
const crossFirmCtx = { params: Promise.resolve({ id: "cross-firm-form" }) };

beforeEach(() => {
  loadFormForFirmMock.mockReset();
  applyIntakeMock.mockReset();
  requireActiveSubscriptionForFirmMock.mockReset();
  requireActiveSubscriptionForFirmMock.mockResolvedValue(undefined);

  // Happy-path default: submitted form
  loadFormForFirmMock.mockResolvedValue({
    id: "form-1",
    firmId: "firm-1",
    status: "submitted",
    clientId: null,
  });
  applyIntakeMock.mockResolvedValue({ clientId: "client-new-1" });
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

  it("returns 404 when loadFormForFirm returns null (cross-firm / nonexistent)", async () => {
    loadFormForFirmMock.mockResolvedValue(null);
    const res = await POST(postReq(), crossFirmCtx);
    expect(res.status).toBe(404);
    expect(applyIntakeMock).not.toHaveBeenCalled();
  });

  it("delegates firm scoping to loadFormForFirm (passes orgId as firmId)", async () => {
    await POST(postReq(), ctx);
    expect(loadFormForFirmMock).toHaveBeenCalledWith("form-1", "firm-1");
  });

  it("returns 403 (not 500) when the firm has no active subscription, without applying", async () => {
    requireActiveSubscriptionForFirmMock.mockRejectedValue(
      new ForbiddenError("Active subscription required"),
    );
    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(403);
    expect(applyIntakeMock).not.toHaveBeenCalled();
    // Gate runs before the form load — a lapsed firm never reaches the DB.
    expect(loadFormForFirmMock).not.toHaveBeenCalled();
  });
});
