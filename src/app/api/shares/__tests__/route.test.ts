import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks — before any imports
// ---------------------------------------------------------------------------
const mockRequireOrgAndUser = vi.fn();
vi.mock("@/lib/db-helpers", () => ({ requireOrgAndUser: mockRequireOrgAndUser }));

const mockCreateShare = vi.fn();
const mockRevokeShare = vi.fn();
vi.mock("@/lib/clients/share-manage", () => ({
  createShare: mockCreateShare,
  revokeShare: mockRevokeShare,
  requireShareManageAccess: vi.fn(),
}));

const mockResolveSharesForRecipient = vi.fn();
vi.mock("@/lib/clients/shared-access", () => ({
  resolveSharesForRecipient: mockResolveSharesForRecipient,
}));

vi.mock("@/db", () => ({ db: mockDb }));
const mockDb = { select: vi.fn() };

vi.mock("@/db/schema", () => ({
  clientShares: {
    firmId: "clientShares.firmId",
    ownerUserId: "clientShares.ownerUserId",
    revokedAt: "clientShares.revokedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  and: (...args: unknown[]) => ({ and: args }),
  isNull: (a: unknown) => ({ isNull: a }),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user_a", orgId: "org_a", orgRole: "org:member" }),
}));

vi.mock("@/lib/authz", () => ({
  authErrorResponse: vi.fn().mockReturnValue(null),
  ForbiddenError: class ForbiddenError extends Error {
    constructor(msg = "Forbidden") { super(msg); this.name = "ForbiddenError"; }
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const FIRM_A = "org_a";
const USER_A = "user_a";
const SHARE_ID = "10000000-0000-0000-0000-000000000099";

function makeRequest(method: string, body?: object, searchParams?: string): NextRequest {
  const url = `http://localhost/api/shares${searchParams ? `?${searchParams}` : ""}`;
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// POST /api/shares
// ---------------------------------------------------------------------------
describe("POST /api/shares", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireOrgAndUser.mockResolvedValue({ orgId: FIRM_A, userId: USER_A });
  });

  it("returns 201 on a successful share-all creation", async () => {
    const share = { id: SHARE_ID, scope: "all" };
    mockCreateShare.mockResolvedValue({ ok: true, share });

    const { POST } = await import("../route");
    const req = makeRequest("POST", { email: "bob@other.com", permission: "view" });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.share).toEqual(share);
    expect(mockCreateShare).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "all", clientId: null, email: "bob@other.com" })
    );
  });

  it("returns 404 when createShare returns 404 (email not found)", async () => {
    mockCreateShare.mockResolvedValue({ ok: false, status: 404, error: "No Foundry user found with that email." });

    const { POST } = await import("../route");
    const req = makeRequest("POST", { email: "nobody@x.com", permission: "view" });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("returns 409 when createShare returns 409 (same firm)", async () => {
    mockCreateShare.mockResolvedValue({ ok: false, status: 409, error: "That user is already a member of this firm and has access." });

    const { POST } = await import("../route");
    const req = makeRequest("POST", { email: "colleague@own.com", permission: "edit" });
    const res = await POST(req);
    expect(res.status).toBe(409);
  });

  it("returns 400 on invalid body (bad email)", async () => {
    const { POST } = await import("../route");
    const req = makeRequest("POST", { email: "not-an-email", permission: "view" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid body (unknown field with .strict())", async () => {
    const { POST } = await import("../route");
    const req = makeRequest("POST", { email: "a@b.com", permission: "view", extra: "field" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/shares
// ---------------------------------------------------------------------------
describe("GET /api/shares", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireOrgAndUser.mockResolvedValue({ orgId: FIRM_A, userId: USER_A });
  });

  it("returns outgoing shares (default direction)", async () => {
    const rows = [{ id: SHARE_ID, scope: "all", firmId: FIRM_A }];
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockResolvedValue(rows);
    mockDb.select.mockReturnValue(chain);

    const { GET } = await import("../route");
    const req = makeRequest("GET");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.shares).toEqual(rows);
  });

  it("returns incoming shares when direction=incoming", async () => {
    const incoming = [{ clientId: "10000000-0000-0000-0000-000000000001", ownerUserId: "other", firmId: "other_firm", permission: "view", scope: "all" }];
    mockResolveSharesForRecipient.mockResolvedValue(incoming);

    const { GET } = await import("../route");
    const req = makeRequest("GET", undefined, "direction=incoming");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.shares).toEqual(incoming);
    expect(mockResolveSharesForRecipient).toHaveBeenCalledWith(USER_A);
  });
});
