import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Auth mocks ────────────────────────────────────────────────────────────────
vi.mock("@/lib/db-helpers", () => ({
  requireOrgAndUser: async () => ({ orgId: "firm-1", userId: "advisor-1" }),
}));

vi.mock("@/lib/authz", () => ({
  authErrorResponse: () => undefined,
}));

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
});
