import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ForbiddenError } from "@/lib/authz";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireOrgAdminOrOwner: vi.fn(),
  deleteFirmProvider: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/authz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authz")>()),
  requireOrgAdminOrOwner: mocks.requireOrgAdminOrOwner,
}));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/workspace/approvals", () => ({ deleteFirmProvider: mocks.deleteFirmProvider }));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKSPACE_ENABLED", "true");
  mocks.auth.mockResolvedValue({ userId: "user_admin", orgId: "org_1", orgRole: "org:admin" });
  mocks.requireOrgAdminOrOwner.mockResolvedValue(undefined);
  mocks.deleteFirmProvider.mockResolvedValue(undefined);
  mocks.recordAudit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/workspace/microsoft/disconnect", () => {
  it("is 404 when Workspace is off", async () => {
    vi.stubEnv("WORKSPACE_ENABLED", "false");
    expect((await POST()).status).toBe(404);
    expect(mocks.deleteFirmProvider).not.toHaveBeenCalled();
  });

  it("refuses a non-admin with 403 and deletes nothing", async () => {
    mocks.requireOrgAdminOrOwner.mockRejectedValue(new ForbiddenError("Organization admin role required"));
    expect((await POST()).status).toBe(403);
    expect(mocks.deleteFirmProvider).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("an admin disconnects the caller's firm and it is audited", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.deleteFirmProvider).toHaveBeenCalledWith("org_1", "microsoft");
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "workspace.firm_disconnect", firmId: "org_1" }),
    );
  });
});
