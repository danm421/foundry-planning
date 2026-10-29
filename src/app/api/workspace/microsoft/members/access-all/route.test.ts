import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ForbiddenError } from "@/lib/authz";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireOrgAdminOrOwner: vi.fn(),
  requireActiveSubscription: vi.fn(),
  listFirmMembers: vi.fn(),
  enableMembers: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/authz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authz")>()),
  requireOrgAdminOrOwner: mocks.requireOrgAdminOrOwner,
  requireActiveSubscription: mocks.requireActiveSubscription,
}));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/crm-tasks/members", () => ({ listFirmMembers: mocks.listFirmMembers }));
vi.mock("@/lib/workspace/access", () => ({ enableMembers: mocks.enableMembers }));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKSPACE_ENABLED", "true");
  mocks.auth.mockResolvedValue({ userId: "user_admin", orgId: "org_1", orgRole: "org:admin" });
  mocks.requireOrgAdminOrOwner.mockResolvedValue(undefined);
  mocks.requireActiveSubscription.mockResolvedValue(undefined);
  mocks.listFirmMembers.mockResolvedValue([{ userId: "user_admin" }, { userId: "user_a" }, { userId: "user_b" }]);
  mocks.enableMembers.mockResolvedValue(3);
  mocks.recordAudit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/workspace/microsoft/members/access-all", () => {
  it("is 404 when Workspace is off", async () => {
    vi.stubEnv("WORKSPACE_ENABLED", "false");
    expect((await POST()).status).toBe(404);
    expect(mocks.enableMembers).not.toHaveBeenCalled();
  });

  it("refuses a non-admin with 403", async () => {
    mocks.requireOrgAdminOrOwner.mockRejectedValue(new ForbiddenError("Organization admin role required"));
    expect((await POST()).status).toBe(403);
    expect(mocks.enableMembers).not.toHaveBeenCalled();
  });

  it("refuses a lapsed firm with 403 and enables no one", async () => {
    mocks.requireActiveSubscription.mockRejectedValue(new ForbiddenError("Active subscription required"));
    expect((await POST()).status).toBe(403);
    expect(mocks.requireOrgAdminOrOwner).toHaveBeenCalled();
    expect(mocks.enableMembers).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("enables every current member of the caller's firm and audits the count", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: 3 });
    expect(mocks.listFirmMembers).toHaveBeenCalledWith("org_1");
    expect(mocks.enableMembers).toHaveBeenCalledWith({
      firmId: "org_1",
      provider: "microsoft",
      userIds: ["user_admin", "user_a", "user_b"],
      updatedByUserId: "user_admin",
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "workspace.member_access",
        firmId: "org_1",
        metadata: { all: true, count: 3 },
      }),
    );
  });
});
