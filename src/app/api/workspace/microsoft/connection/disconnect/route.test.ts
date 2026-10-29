import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  deleteUserConnection: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/workspace/connections", () => ({ deleteUserConnection: mocks.deleteUserConnection }));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKSPACE_ENABLED", "true");
  mocks.auth.mockResolvedValue({ userId: "user_ada", orgId: "org_1", orgRole: "org:member" });
  mocks.deleteUserConnection.mockResolvedValue(undefined);
  mocks.recordAudit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/workspace/microsoft/connection/disconnect", () => {
  it("is 404 when Workspace is off, like its siblings, and deletes nothing", async () => {
    vi.stubEnv("WORKSPACE_ENABLED", "false");
    expect((await POST()).status).toBe(404);
    expect(mocks.deleteUserConnection).not.toHaveBeenCalled();
  });

  it("refuses a request with no session (401) and deletes nothing", async () => {
    mocks.auth.mockResolvedValue({ userId: null, orgId: null });
    expect((await POST()).status).toBe(401);
    expect(mocks.deleteUserConnection).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("an advisor drops only their own connection, and it is audited with ids only", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // The session names whose row goes: the route takes no user id at all.
    expect(mocks.deleteUserConnection).toHaveBeenCalledTimes(1);
    expect(mocks.deleteUserConnection).toHaveBeenCalledWith("org_1", "user_ada", "microsoft");
    expect(mocks.recordAudit).toHaveBeenCalledWith({
      action: "workspace.disconnect",
      resourceType: "workspace_connection",
      resourceId: "user_ada",
      firmId: "org_1",
      metadata: { provider: "microsoft", userId: "user_ada" },
    });
  });

  it("a store failure is a generic 500 that logs no detail", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.deleteUserConnection.mockRejectedValue(new Error("Failed query: delete params: user_ada secret"));
    expect((await POST()).status).toBe(500);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret");
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });
});
