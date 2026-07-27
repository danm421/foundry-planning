import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
const mockUpdateOrg = vi.fn();
const mockGetOrg = vi.fn();
const mockDbUpdate = vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) }));
const mockOnConflictDoUpdate = vi.fn(async (..._args: unknown[]) => undefined);
const mockValues = vi.fn((v: unknown) => ({
  onConflictDoUpdate: (o: unknown) => mockOnConflictDoUpdate(v, o),
}));
const mockDbInsert = vi.fn(() => ({ values: mockValues }));
const mockRecordAudit = vi.fn(async (..._args: unknown[]) => {});
const mockRevalidatePath = vi.fn();
const mockRequireAdminOrOwner = vi.fn(async () => {});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
  clerkClient: async () => ({
    organizations: {
      getOrganization: mockGetOrg,
      updateOrganization: mockUpdateOrg,
    },
  }),
}));
vi.mock("@/db", () => ({
  db: {
    update: () => mockDbUpdate(),
    insert: () => mockDbInsert(),
  },
}));
vi.mock("@/db/schema", () => ({
  firms: { firmId: "firms.firm_id" },
}));
vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
}));
vi.mock("@/lib/audit", () => ({
  recordAudit: (...a: unknown[]) => mockRecordAudit(...a),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string, scope: string) => mockRevalidatePath(p, scope),
}));
vi.mock("@/lib/authz", () => ({
  requireOrgAdminOrOwner: () => mockRequireAdminOrOwner(),
  ForbiddenError: class ForbiddenError extends Error {},
}));

import { renameFirm, setBookSiloEnabled } from "../actions";

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: "user_1", orgId: "org_1" });
  mockGetOrg.mockResolvedValue({ id: "org_1", name: "Old Name" });
  mockUpdateOrg.mockResolvedValue({ id: "org_1", name: "New Name" });
});

function fd(displayName: unknown): FormData {
  const f = new FormData();
  if (typeof displayName === "string") f.set("displayName", displayName);
  return f;
}

describe("renameFirm", () => {
  it("rejects empty displayName", async () => {
    const result = await renameFirm(fd(""));
    expect(result).toEqual(expect.objectContaining({ ok: false }));
    expect(mockUpdateOrg).not.toHaveBeenCalled();
  });

  it("rejects displayName > 80 chars", async () => {
    const result = await renameFirm(fd("x".repeat(81)));
    expect(result.ok).toBe(false);
    expect(mockUpdateOrg).not.toHaveBeenCalled();
  });

  it("trims whitespace and rejects when only-whitespace", async () => {
    const result = await renameFirm(fd("   "));
    expect(result.ok).toBe(false);
    expect(mockUpdateOrg).not.toHaveBeenCalled();
  });

  it("returns noop when displayName equals current Clerk org name (post-trim)", async () => {
    mockGetOrg.mockResolvedValue({ id: "org_1", name: "Same Name" });
    const result = await renameFirm(fd("  Same Name  "));
    expect(result).toEqual({ ok: true, noop: true });
    expect(mockUpdateOrg).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("returns ok and writes audit on full success", async () => {
    const result = await renameFirm(fd("New Name"));
    expect(result).toEqual({ ok: true });
    expect(mockUpdateOrg).toHaveBeenCalledWith("org_1", { name: "New Name" });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "firm.name_changed",
        firmId: "org_1",
        metadata: expect.objectContaining({ before: "Old Name", after: "New Name" }),
      }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("returns error when Clerk update throws (DB and audit untouched)", async () => {
    mockUpdateOrg.mockRejectedValue(new Error("clerk down"));
    const result = await renameFirm(fd("New Name"));
    expect(result.ok).toBe(false);
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("returns ok with divergenceWarning when DB update fails after Clerk succeeded", async () => {
    mockDbUpdate.mockImplementationOnce(() => ({
      set: () => ({ where: () => Promise.reject(new Error("db down")) }),
    }));
    const result = await renameFirm(fd("New Name"));
    expect(result).toEqual(expect.objectContaining({ ok: true, divergenceWarning: true }));
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "firm.name_changed",
        metadata: expect.objectContaining({ divergence: true }),
      }),
    );
  });

  it("re-throws ForbiddenError from authz (caller is responsible)", async () => {
    const { ForbiddenError } = await import("@/lib/authz");
    mockRequireAdminOrOwner.mockRejectedValueOnce(new ForbiddenError("nope"));
    await expect(renameFirm(fd("New Name"))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("setBookSiloEnabled", () => {
  it("re-throws ForbiddenError from authz (caller is responsible)", async () => {
    const { ForbiddenError } = await import("@/lib/authz");
    mockRequireAdminOrOwner.mockRejectedValueOnce(new ForbiddenError("nope"));
    await expect(setBookSiloEnabled(true)).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("returns an error when there's no active org", async () => {
    mockAuth.mockResolvedValue({ userId: null, orgId: null });
    const result = await setBookSiloEnabled(true);
    expect(result).toEqual({ ok: false, error: "No active org" });
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("writes via insert(...).onConflictDoUpdate(...) — never a bare db.update(firms)", async () => {
    const result = await setBookSiloEnabled(true);
    expect(result).toEqual({ ok: true });
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      { firmId: "org_1", bookSiloEnabled: true },
      expect.objectContaining({
        target: "firms.firm_id",
        set: expect.objectContaining({ bookSiloEnabled: true, updatedAt: expect.any(Date) }),
      }),
    );
  });

  it("records firm.book_silo_changed with metadata.enabled reflecting the new value — on", async () => {
    await setBookSiloEnabled(true);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "firm.book_silo_changed",
        resourceType: "firm",
        resourceId: "org_1",
        firmId: "org_1",
        metadata: { enabled: true },
      }),
    );
  });

  it("records firm.book_silo_changed with metadata.enabled reflecting the new value — off", async () => {
    await setBookSiloEnabled(false);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "firm.book_silo_changed",
        metadata: { enabled: false },
      }),
    );
  });

  it("revalidates the whole layout, matching renameFirm's broad invalidation", async () => {
    await setBookSiloEnabled(true);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});
