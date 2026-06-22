import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Auth mocks ────────────────────────────────────────────────────────────────
vi.mock("@/lib/db-helpers", () => ({
  requireOrgAndUser: async () => ({ orgId: "firm-1", userId: "advisor-1" }),
}));

vi.mock("@/lib/authz", () => ({
  authErrorResponse: () => undefined,
}));

// ── DB mock ───────────────────────────────────────────────────────────────────
const dbUpdateMock = vi.fn();

vi.mock("@/db", () => ({
  db: {
    update: (_table: unknown) => ({
      set: (vals: unknown) => ({
        where: (_cond: unknown) => dbUpdateMock(vals),
      }),
    }),
  },
}));

// ── loadFormForFirm mock ──────────────────────────────────────────────────────
const loadFormForFirmMock = vi.fn();
vi.mock("@/lib/intake/queries", () => ({
  loadFormForFirm: (id: string, firmId: string) => loadFormForFirmMock(id, firmId),
}));

// ── Audit mock ────────────────────────────────────────────────────────────────
const recordAuditMock = vi.fn();
vi.mock("@/lib/audit", () => ({
  recordAudit: (args: unknown) => recordAuditMock(args),
}));

import { POST } from "@/app/api/data-collection/[id]/discard/route";

// ── Helpers ───────────────────────────────────────────────────────────────────
function postReq() {
  return new Request("http://localhost/api/data-collection/form-1/discard", {
    method: "POST",
  });
}

const ctx = { params: Promise.resolve({ id: "form-1" }) };
const crossFirmCtx = { params: Promise.resolve({ id: "cross-firm-form" }) };

beforeEach(() => {
  loadFormForFirmMock.mockReset();
  dbUpdateMock.mockReset();
  recordAuditMock.mockReset();

  // Happy-path default: submitted form with a known clientId
  loadFormForFirmMock.mockResolvedValue({
    id: "form-1",
    firmId: "firm-1",
    status: "submitted",
    clientId: "client-1",
  });
  dbUpdateMock.mockResolvedValue(undefined);
  recordAuditMock.mockResolvedValue(undefined);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/data-collection/[id]/discard", () => {
  it("updates status to discarded and audits intake.form.discarded", async () => {
    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    // Status update
    expect(dbUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "discarded", updatedAt: expect.any(Date) }),
    );

    // Audit — no actorId (self-resolves via auth())
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "intake.form.discarded",
        resourceType: "intake_form",
        resourceId: "form-1",
        clientId: "client-1",
        firmId: "firm-1",
      }),
    );
    // Must NOT pass actorId — ops-impersonation attribution depends on this
    const callArg = recordAuditMock.mock.calls[0][0];
    expect(callArg).not.toHaveProperty("actorId");
  });

  it("returns 409 when form is already applied", async () => {
    loadFormForFirmMock.mockResolvedValue({
      id: "form-1",
      firmId: "firm-1",
      status: "applied",
      clientId: "client-1",
    });
    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(409);
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("returns 404 when loadFormForFirm returns null (cross-firm / nonexistent)", async () => {
    loadFormForFirmMock.mockResolvedValue(null);
    const res = await POST(postReq(), crossFirmCtx);
    expect(res.status).toBe(404);
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it("handles null clientId on form", async () => {
    loadFormForFirmMock.mockResolvedValue({
      id: "form-1",
      firmId: "firm-1",
      status: "submitted",
      clientId: null,
    });
    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(200);
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: null }),
    );
  });
});
