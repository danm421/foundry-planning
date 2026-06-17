import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — declared before any import so vitest hoisting works correctly
// ---------------------------------------------------------------------------
const mockAuth = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));

vi.mock("@/db", () => ({ db: mockDb }));
const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
};

vi.mock("@/db/schema", () => ({
  clients: { id: "clients.id", firmId: "clients.firmId", advisorId: "clients.advisorId" },
  clientShares: { id: "clientShares.id", firmId: "clientShares.firmId", ownerUserId: "clientShares.ownerUserId", revokedAt: "clientShares.revokedAt" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  and: (...args: unknown[]) => ({ and: args }),
  isNull: (a: unknown) => ({ isNull: a }),
}));

vi.mock("@/lib/authz", () => ({
  ForbiddenError: class ForbiddenError extends Error {
    constructor(msg = "Forbidden") { super(msg); this.name = "ForbiddenError"; }
  },
}));

vi.mock("@/lib/db-helpers", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor(msg = "Unauthorized") { super(msg); this.name = "UnauthorizedError"; }
  },
}));

vi.mock("../share-recipients", () => ({
  resolveRecipientByEmail: mockResolveRecipientByEmail,
  isMemberOfFirm: mockIsMemberOfFirm,
}));

vi.mock("@/lib/audit", () => ({
  recordAudit: mockRecordAudit,
}));

const mockResolveRecipientByEmail = vi.fn();
const mockIsMemberOfFirm = vi.fn();
const mockRecordAudit = vi.fn();

// ---------------------------------------------------------------------------
// Helpers to build drizzle-style fluent chain mocks
// ---------------------------------------------------------------------------
function makeSelectChain(returnValue: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockResolvedValue(returnValue);
  return chain;
}

function makeInsertChain(returnValue: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.values = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(returnValue);
  return chain;
}

function makeUpdateChain() {
  const chain: Record<string, unknown> = {};
  chain.set = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockResolvedValue([]);
  return chain;
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const FIRM_A = "org_firm_a";
const FIRM_B = "org_firm_b";
const ADVISOR_ID = "user_advisor";
const ADMIN_ID = "user_admin";
const OTHER_USER = "user_other";
const RECIPIENT_ID = "user_recipient";
const CLIENT_ID = "10000000-0000-0000-0000-000000000001";
const SHARE_ID = "10000000-0000-0000-0000-000000000099";

const mockClient = {
  id: CLIENT_ID,
  firmId: FIRM_A,
  advisorId: ADVISOR_ID,
};

// ---------------------------------------------------------------------------
// Import AFTER mocks are registered
// ---------------------------------------------------------------------------
import { ForbiddenError } from "@/lib/authz";
import { UnauthorizedError } from "@/lib/db-helpers";

beforeEach(() => {
  vi.clearAllMocks();
  mockRecordAudit.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// requireShareManageAccess
// ---------------------------------------------------------------------------
describe("requireShareManageAccess", () => {
  it("allows the owning advisor (same firm)", async () => {
    mockAuth.mockResolvedValue({ userId: ADVISOR_ID, orgId: FIRM_A, orgRole: "org:member" });
    mockDb.select.mockReturnValue(makeSelectChain([mockClient]));

    const { requireShareManageAccess } = await import("../share-manage");
    const result = await requireShareManageAccess(CLIENT_ID);
    expect(result.client).toEqual(mockClient);
    expect(result.firmId).toBe(FIRM_A);
    expect(result.ownerUserId).toBe(ADVISOR_ID);
  });

  it("allows an org:admin from the owning firm (not the owner)", async () => {
    mockAuth.mockResolvedValue({ userId: ADMIN_ID, orgId: FIRM_A, orgRole: "org:admin" });
    mockDb.select.mockReturnValue(makeSelectChain([mockClient]));

    const { requireShareManageAccess } = await import("../share-manage");
    const result = await requireShareManageAccess(CLIENT_ID);
    expect(result.firmId).toBe(FIRM_A);
  });

  it("denies a non-admin, non-owner member of the owning firm", async () => {
    mockAuth.mockResolvedValue({ userId: OTHER_USER, orgId: FIRM_A, orgRole: "org:member" });
    mockDb.select.mockReturnValue(makeSelectChain([mockClient]));

    const { requireShareManageAccess } = await import("../share-manage");
    await expect(requireShareManageAccess(CLIENT_ID)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("denies an advisor in the wrong firm (even if they'd be admin there)", async () => {
    mockAuth.mockResolvedValue({ userId: ADVISOR_ID, orgId: FIRM_B, orgRole: "org:admin" });
    mockDb.select.mockReturnValue(makeSelectChain([mockClient]));

    const { requireShareManageAccess } = await import("../share-manage");
    await expect(requireShareManageAccess(CLIENT_ID)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws UnauthorizedError when no userId", async () => {
    mockAuth.mockResolvedValue({ userId: null, orgId: null, orgRole: null });
    // DB shouldn't be called but set up anyway
    mockDb.select.mockReturnValue(makeSelectChain([]));

    const { requireShareManageAccess } = await import("../share-manage");
    await expect(requireShareManageAccess(CLIENT_ID)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws ForbiddenError when the client doesn't exist", async () => {
    mockAuth.mockResolvedValue({ userId: ADVISOR_ID, orgId: FIRM_A, orgRole: "org:member" });
    mockDb.select.mockReturnValue(makeSelectChain([]));

    const { requireShareManageAccess } = await import("../share-manage");
    await expect(requireShareManageAccess(CLIENT_ID)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ---------------------------------------------------------------------------
// createShare
// ---------------------------------------------------------------------------
describe("createShare", () => {
  const baseArgs = {
    scope: "all" as const,
    email: "recipient@other.com",
    permission: "view" as const,
    firmId: FIRM_A,
    ownerUserId: ADVISOR_ID,
    clientId: null,
    actorId: ADVISOR_ID,
  };

  it("returns 404 when email doesn't resolve to a Foundry user", async () => {
    mockResolveRecipientByEmail.mockResolvedValue(null);

    const { createShare } = await import("../share-manage");
    const result = await createShare(baseArgs);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });

  it("returns 409 when recipient is already a member of the owning firm", async () => {
    mockResolveRecipientByEmail.mockResolvedValue({ userId: RECIPIENT_ID, email: "recipient@other.com" });
    mockIsMemberOfFirm.mockResolvedValue(true);

    const { createShare } = await import("../share-manage");
    const result = await createShare(baseArgs);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
    }
  });

  it("inserts a valid share-all and calls recordAudit", async () => {
    mockResolveRecipientByEmail.mockResolvedValue({ userId: RECIPIENT_ID, email: "recipient@other.com" });
    mockIsMemberOfFirm.mockResolvedValue(false);
    const newShare = { id: SHARE_ID, scope: "all", firmId: FIRM_A, ownerUserId: ADVISOR_ID, clientId: null };
    mockDb.insert.mockReturnValue(makeInsertChain([newShare]));

    const { createShare } = await import("../share-manage");
    const result = await createShare(baseArgs);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.share).toEqual(newShare);
    }
    expect(mockRecordAudit).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "client_share.create",
      resourceType: "client_share",
      firmId: FIRM_A,
    }));
  });

  it("inserts a valid per-client share with scope:client", async () => {
    mockResolveRecipientByEmail.mockResolvedValue({ userId: RECIPIENT_ID, email: "recipient@other.com" });
    mockIsMemberOfFirm.mockResolvedValue(false);
    const newShare = { id: SHARE_ID, scope: "client", firmId: FIRM_A, ownerUserId: ADVISOR_ID, clientId: CLIENT_ID };
    mockDb.insert.mockReturnValue(makeInsertChain([newShare]));

    const { createShare } = await import("../share-manage");
    const result = await createShare({ ...baseArgs, scope: "client", clientId: CLIENT_ID });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.share.scope).toBe("client");
    }
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "client_share.create",
      clientId: CLIENT_ID,
    }));
  });

  it("returns 409 on unique constraint violation (code 23505)", async () => {
    mockResolveRecipientByEmail.mockResolvedValue({ userId: RECIPIENT_ID, email: "recipient@other.com" });
    mockIsMemberOfFirm.mockResolvedValue(false);
    const dupErr = Object.assign(new Error("duplicate key"), { code: "23505" });
    // Make .returning() throw
    const chain: Record<string, unknown> = {};
    chain.values = vi.fn().mockReturnValue(chain);
    chain.returning = vi.fn().mockRejectedValue(dupErr);
    mockDb.insert.mockReturnValue(chain);

    const { createShare } = await import("../share-manage");
    const result = await createShare(baseArgs);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
    }
  });

  it("rethrows non-23505 DB errors", async () => {
    mockResolveRecipientByEmail.mockResolvedValue({ userId: RECIPIENT_ID, email: "recipient@other.com" });
    mockIsMemberOfFirm.mockResolvedValue(false);
    const dbErr = new Error("connection timeout");
    const chain: Record<string, unknown> = {};
    chain.values = vi.fn().mockReturnValue(chain);
    chain.returning = vi.fn().mockRejectedValue(dbErr);
    mockDb.insert.mockReturnValue(chain);

    const { createShare } = await import("../share-manage");
    await expect(createShare(baseArgs)).rejects.toThrow("connection timeout");
  });
});

// ---------------------------------------------------------------------------
// revokeShare
// ---------------------------------------------------------------------------
describe("revokeShare", () => {
  const ownerCaller = { userId: ADVISOR_ID, orgId: FIRM_A, orgRole: "org:member" as string | null | undefined };
  const adminCaller = { userId: ADMIN_ID, orgId: FIRM_A, orgRole: "org:admin" as string | null | undefined };
  const outsiderCaller = { userId: OTHER_USER, orgId: FIRM_B, orgRole: "org:member" as string | null | undefined };

  const activeShare = {
    id: SHARE_ID,
    firmId: FIRM_A,
    ownerUserId: ADVISOR_ID,
    clientId: null,
    scope: "all",
    revokedAt: null,
  };

  it("allows owner to revoke their own share", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([activeShare]));
    mockDb.update.mockReturnValue(makeUpdateChain());

    const { revokeShare } = await import("../share-manage");
    const result = await revokeShare(SHARE_ID, ownerCaller);
    expect(result.ok).toBe(true);
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "client_share.revoke",
    }));
  });

  it("allows firm admin to revoke a share they don't own", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([activeShare]));
    mockDb.update.mockReturnValue(makeUpdateChain());

    const { revokeShare } = await import("../share-manage");
    const result = await revokeShare(SHARE_ID, adminCaller);
    expect(result.ok).toBe(true);
  });

  it("denies outsider (different firm, non-owner)", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([activeShare]));

    const { revokeShare } = await import("../share-manage");
    await expect(revokeShare(SHARE_ID, outsiderCaller)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError if share not found", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([]));

    const { revokeShare } = await import("../share-manage");
    await expect(revokeShare(SHARE_ID, ownerCaller)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError if share already revoked", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([{ ...activeShare, revokedAt: new Date() }]));

    const { revokeShare } = await import("../share-manage");
    await expect(revokeShare(SHARE_ID, ownerCaller)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
