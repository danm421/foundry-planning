import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock requireShareManageAccess from share-manage before any imports
// ---------------------------------------------------------------------------
const mockRequireShareManageAccess = vi.fn();

vi.mock("@/lib/clients/share-manage", () => ({
  requireShareManageAccess: mockRequireShareManageAccess,
}));

// ---------------------------------------------------------------------------
// Mock auth (Clerk) — base happy-path values overridden per-test as needed
// ---------------------------------------------------------------------------
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({
    userId: "user_owner",
    orgId: "10000000-0000-0000-0000-000000000011",
    orgRole: "org:member",
  }),
}));

// ---------------------------------------------------------------------------
// Track recordAudit calls
// ---------------------------------------------------------------------------
const mockRecordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  recordAudit: mockRecordAudit,
}));

// ---------------------------------------------------------------------------
// Minimal DB mock — track what update().set().where() was called with
// ---------------------------------------------------------------------------
type UpdateCall = { isPrivate: boolean; updatedAt: Date };
const updateCalls: UpdateCall[] = [];

vi.mock("@/db", () => {
  return {
    db: {
      update: (_table: unknown) => ({
        set: (values: UpdateCall) => ({
          where: (_cond: unknown) => {
            updateCalls.push(values);
            return Promise.resolve();
          },
        }),
      }),
    },
  };
});

vi.mock("@/db/schema", async () => {
  const actual = await vi.importActual<typeof import("@/db/schema")>("@/db/schema");
  return actual;
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CLIENT_A_ID = "10000000-0000-0000-0000-000000000001";
const FIRM_A_ID = "10000000-0000-0000-0000-000000000011";

const OWNER_RESULT = {
  client: { id: CLIENT_A_ID, firmId: FIRM_A_ID, advisorId: "user_owner", isPrivate: false },
  firmId: FIRM_A_ID,
  ownerUserId: "user_owner",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRequest(body: unknown) {
  return new Request("http://x", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) } as unknown as { params: Promise<{ id: string }> };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PUT /api/clients/[id]/privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateCalls.length = 0;
  });

  it("owning advisor can flip isPrivate to true (200, row updated)", async () => {
    mockRequireShareManageAccess.mockResolvedValue(OWNER_RESULT);
    const { PUT } = await import("../route");

    const res = await PUT(makeRequest({ isPrivate: true }), makeParams(CLIENT_A_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, isPrivate: true });

    // DB update was called with correct value
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].isPrivate).toBe(true);
    expect(updateCalls[0].updatedAt).toBeInstanceOf(Date);
  });

  it("owning advisor can flip isPrivate to false (200, row updated)", async () => {
    mockRequireShareManageAccess.mockResolvedValue(OWNER_RESULT);
    const { PUT } = await import("../route");

    const res = await PUT(makeRequest({ isPrivate: false }), makeParams(CLIENT_A_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, isPrivate: false });
    expect(updateCalls[0].isPrivate).toBe(false);
  });

  it("shared-edit recipient is rejected with 403", async () => {
    const { ForbiddenError } = await import("@/lib/authz");
    mockRequireShareManageAccess.mockRejectedValue(
      new ForbiddenError("Client not found or access denied"),
    );
    const { PUT } = await import("../route");

    const res = await PUT(makeRequest({ isPrivate: true }), makeParams(CLIENT_A_ID));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Client not found or access denied");

    // No DB update should have occurred
    expect(updateCalls).toHaveLength(0);
  });

  it("unauthenticated caller is rejected with 401", async () => {
    const { UnauthorizedError } = await import("@/lib/db-helpers");
    mockRequireShareManageAccess.mockRejectedValue(new UnauthorizedError());
    const { PUT } = await import("../route");

    const res = await PUT(makeRequest({ isPrivate: true }), makeParams(CLIENT_A_ID));

    expect(res.status).toBe(401);
  });

  it("non-boolean isPrivate returns 400", async () => {
    mockRequireShareManageAccess.mockResolvedValue(OWNER_RESULT);
    const { PUT } = await import("../route");

    const res = await PUT(makeRequest({ isPrivate: "yes" }), makeParams(CLIENT_A_ID));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/boolean/);
    expect(updateCalls).toHaveLength(0);
  });

  it("missing isPrivate returns 400", async () => {
    mockRequireShareManageAccess.mockResolvedValue(OWNER_RESULT);
    const { PUT } = await import("../route");

    const res = await PUT(makeRequest({}), makeParams(CLIENT_A_ID));

    expect(res.status).toBe(400);
    expect(updateCalls).toHaveLength(0);
  });

  it("audits client.update with isPrivate in metadata", async () => {
    mockRequireShareManageAccess.mockResolvedValue(OWNER_RESULT);
    const { PUT } = await import("../route");

    await PUT(makeRequest({ isPrivate: true }), makeParams(CLIENT_A_ID));

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "client.update",
        resourceType: "client",
        resourceId: CLIENT_A_ID,
        clientId: CLIENT_A_ID,
        firmId: FIRM_A_ID,
        metadata: { isPrivate: true },
      }),
    );
  });
});
