// src/app/api/clients/[id]/snapshots/[snapId]/__tests__/route.test.ts
//
// Unit tests for the per-snapshot route (GET read + DELETE). Mocks at the lib
// boundary so the suite runs without a live DB. Focus is on auth/scope gates,
// the not-found branch, and audit shape.
//
// Task 17d: DELETE now uses requireOrgAndUser + requireClientEditAccess +
// requireActiveSubscriptionForFirm. Client-not-found collapses to 403 (uniform
// denial from ForbiddenError). GET is unchanged.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user_test", orgId: "firm_test" }),
}));

vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: vi.fn(),
  requireOrgAndUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor(message = "Unauthorized") {
      super(message);
      this.name = "UnauthorizedError";
    }
  },
}));

vi.mock("@/lib/db-scoping", () => ({
  findClientInFirm: vi.fn<
    () => Promise<{ id: string } | null>
  >(),
}));

// GET uses verifyClientAccess; DELETE uses requireClientEditAccess.
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi.fn(async (_clientId: string) => {
    const { findClientInFirm } = await import("@/lib/db-scoping");
    return (await findClientInFirm(_clientId, "firm_test")) != null
      ? { ok: true, permission: "edit", firmId: "firm_test", access: "own" }
      : { ok: false };
  }),
  requireClientEditAccess: vi.fn(),
}));

vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return {
    ...actual,
    requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined),
    authErrorResponse: actual.authErrorResponse,
  };
});

vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>(
    "@/lib/audit",
  );
  return { ...actual, recordAudit: vi.fn().mockResolvedValue(undefined) };
});

// Rebindable per-test return for the `select(...).from(...).where(...)` chain.
const selectWhereResolve = vi.fn<() => Promise<unknown[]>>();
const deleteWhereResolve = vi.fn<() => Promise<void>>(() => Promise.resolve());

vi.mock("@/db", () => {
  const where = vi.fn(() => selectWhereResolve());
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  const dWhere = vi.fn(() => deleteWhereResolve());
  const del = vi.fn(() => ({ where: dWhere }));

  return { db: { select, delete: del } };
});

import { requireOrgAndUser } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { GET, DELETE } from "../route";

const CLIENT_ID = "cli_test";
const FIRM_ID = "firm_test";
const SNAP_ID = "snap-1";

function makeReq(method: "GET" | "DELETE") {
  return new Request("http://test.local", {
    method,
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.mocked(requireOrgAndUser).mockReset();
  vi.mocked(findClientInFirm).mockReset();
  vi.mocked(requireClientEditAccess).mockReset();
  vi.mocked(requireActiveSubscriptionForFirm).mockResolvedValue(undefined);
  vi.mocked(recordAudit).mockClear();
  selectWhereResolve.mockReset();
  deleteWhereResolve.mockReset().mockResolvedValue(undefined);
});

describe("GET /api/clients/[id]/snapshots/[snapId]", () => {
  it("returns 404 without org context (no-org denied uniformly)", async () => {
    // GET uses verifyClientAccess which returns {ok:false} when findClientInFirm
    // is unset — unauthenticated requests are denied with 404.
    const res = await GET(makeReq("GET"), {
      params: Promise.resolve({ id: CLIENT_ID, snapId: SNAP_ID }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the client is in another firm", async () => {
    vi.mocked(findClientInFirm).mockResolvedValueOnce(
      null as unknown as { id: string },
    );

    const res = await GET(makeReq("GET"), {
      params: Promise.resolve({ id: CLIENT_ID, snapId: SNAP_ID }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the snapshot doesn't belong to this client", async () => {
    vi.mocked(findClientInFirm).mockResolvedValueOnce({ id: CLIENT_ID });
    selectWhereResolve.mockResolvedValueOnce([]);

    const res = await GET(makeReq("GET"), {
      params: Promise.resolve({ id: CLIENT_ID, snapId: SNAP_ID }),
    });
    expect(res.status).toBe(404);
  });

  it("returns the snapshot row on the happy path", async () => {
    vi.mocked(findClientInFirm).mockResolvedValueOnce({ id: CLIENT_ID });
    selectWhereResolve.mockResolvedValueOnce([
      { id: SNAP_ID, clientId: CLIENT_ID, name: "X", sourceKind: "manual" },
    ]);

    const res = await GET(makeReq("GET"), {
      params: Promise.resolve({ id: CLIENT_ID, snapId: SNAP_ID }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { snapshot: { id: string } };
    expect(body.snapshot.id).toBe(SNAP_ID);
  });
});

describe("DELETE /api/clients/[id]/snapshots/[snapId]", () => {
  it("returns 401 without org context", async () => {
    const { UnauthorizedError } = await import("@/lib/db-helpers");
    vi.mocked(requireOrgAndUser).mockRejectedValueOnce(new UnauthorizedError());

    const res = await DELETE(makeReq("DELETE"), {
      params: Promise.resolve({ id: CLIENT_ID, snapId: SNAP_ID }),
    });
    expect(res.status).toBe(401);
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("returns 403 when client is in a different firm (uniform denial)", async () => {
    // Task 17d: client-not-found collapses to 403 via ForbiddenError.
    const { ForbiddenError } = await import("@/lib/authz");
    vi.mocked(requireOrgAndUser).mockResolvedValueOnce({ orgId: FIRM_ID, userId: "user_test" });
    vi.mocked(requireClientEditAccess).mockRejectedValueOnce(
      new ForbiddenError("Client not found or access denied"),
    );

    const res = await DELETE(makeReq("DELETE"), {
      params: Promise.resolve({ id: CLIENT_ID, snapId: SNAP_ID }),
    });
    expect(res.status).toBe(403);
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("returns 404 when the snapshot is missing for this client", async () => {
    vi.mocked(requireOrgAndUser).mockResolvedValueOnce({ orgId: FIRM_ID, userId: "user_test" });
    vi.mocked(requireClientEditAccess).mockResolvedValueOnce({ firmId: FIRM_ID, access: "own" as const } as never);
    selectWhereResolve.mockResolvedValueOnce([]);

    const res = await DELETE(makeReq("DELETE"), {
      params: Promise.resolve({ id: CLIENT_ID, snapId: SNAP_ID }),
    });
    expect(res.status).toBe(404);
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("deletes and audits with snapshot.delete on success", async () => {
    vi.mocked(requireOrgAndUser).mockResolvedValueOnce({ orgId: FIRM_ID, userId: "user_test" });
    vi.mocked(requireClientEditAccess).mockResolvedValueOnce({ firmId: FIRM_ID, access: "own" as const } as never);
    selectWhereResolve.mockResolvedValueOnce([
      { id: SNAP_ID, name: "Q1 review" },
    ]);

    const res = await DELETE(makeReq("DELETE"), {
      params: Promise.resolve({ id: CLIENT_ID, snapId: SNAP_ID }),
    });
    expect(res.status).toBe(200);
    expect(deleteWhereResolve).toHaveBeenCalled();

    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "snapshot.delete",
        resourceType: "scenario_snapshot",
        resourceId: SNAP_ID,
        clientId: CLIENT_ID,
        firmId: FIRM_ID,
        metadata: { name: "Q1 review" },
      }),
    );
  });
});
