import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireActiveSubscription: vi.fn(),
  deleteFirmWorkspace: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/authz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authz")>()),
  requireActiveSubscription: mocks.requireActiveSubscription,
}));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/workspace/approvals", () => ({ deleteFirmWorkspace: mocks.deleteFirmWorkspace }));

import { POST } from "./route";

const ADMIN = { userId: "user_admin", orgId: "org_1", orgRole: "org:admin" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKSPACE_ENABLED", "true");
  mocks.auth.mockResolvedValue(ADMIN);
  mocks.requireActiveSubscription.mockResolvedValue(undefined);
  mocks.deleteFirmWorkspace.mockResolvedValue(undefined);
  mocks.recordAudit.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/workspace/admin/disconnect-all", () => {
  it("is 404 when Workspace is off", async () => {
    vi.stubEnv("WORKSPACE_ENABLED", "false");
    expect((await POST()).status).toBe(404);
    expect(mocks.deleteFirmWorkspace).not.toHaveBeenCalled();
  });

  it("refuses a non-admin with 403 and deletes nothing", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_ada", orgId: "org_1", orgRole: "org:member" });
    expect((await POST()).status).toBe(403);
    expect(mocks.deleteFirmWorkspace).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("is 403 impersonating, even as an admin, and deletes nothing", async () => {
    mocks.auth.mockResolvedValue({ ...ADMIN, actor: { sub: "user_ops" } });
    const res = await POST();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "impersonating" });
    expect(mocks.deleteFirmWorkspace).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("an admin removes the caller's firm's whole Workspace, every provider, and it is audited", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.deleteFirmWorkspace).toHaveBeenCalledWith("org_1");
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "workspace.firm_disconnect", firmId: "org_1" }),
    );
  });

  it("isn't gated on the subscription", async () => {
    mocks.requireActiveSubscription.mockRejectedValue(new Error("lapsed"));
    expect((await POST()).status).toBe(200);
    expect(mocks.requireActiveSubscription).not.toHaveBeenCalled();
  });
});
