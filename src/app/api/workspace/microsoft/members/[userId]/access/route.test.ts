import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ForbiddenError } from "@/lib/authz";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireOrgAdminOrOwner: vi.fn(),
  listFirmMembers: vi.fn(),
  setMemberAccess: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/authz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authz")>()),
  requireOrgAdminOrOwner: mocks.requireOrgAdminOrOwner,
}));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/crm-tasks/members", () => ({ listFirmMembers: mocks.listFirmMembers }));
vi.mock("@/lib/workspace/access", () => ({ setMemberAccess: mocks.setMemberAccess }));

import { POST } from "./route";

function post(userId: string, body: unknown) {
  const req = new Request(`https://app.test/api/workspace/microsoft/members/${userId}/access`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ userId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKSPACE_ENABLED", "true");
  mocks.auth.mockResolvedValue({ userId: "user_admin", orgId: "org_1", orgRole: "org:admin" });
  mocks.requireOrgAdminOrOwner.mockResolvedValue(undefined);
  mocks.listFirmMembers.mockResolvedValue([{ userId: "user_admin" }, { userId: "user_adv" }]);
  mocks.setMemberAccess.mockResolvedValue(undefined);
  mocks.recordAudit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/workspace/microsoft/members/[userId]/access", () => {
  it("is 404 when Workspace is off", async () => {
    vi.stubEnv("WORKSPACE_ENABLED", "");
    const res = await post("user_adv", { enabled: true });
    expect(res.status).toBe(404);
    expect(mocks.setMemberAccess).not.toHaveBeenCalled();
  });

  it("refuses a non-admin with 403", async () => {
    mocks.requireOrgAdminOrOwner.mockRejectedValue(new ForbiddenError("Organization admin role required"));
    const res = await post("user_adv", { enabled: true });
    expect(res.status).toBe(403);
    expect(mocks.setMemberAccess).not.toHaveBeenCalled();
  });

  it("404s a user who isn't in the caller's firm, and flips nothing", async () => {
    const res = await post("user_elsewhere", { enabled: true });
    expect(res.status).toBe(404);
    expect(mocks.listFirmMembers).toHaveBeenCalledWith("org_1");
    expect(mocks.setMemberAccess).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("{enabled:false} switches the advisor off and audits it", async () => {
    const res = await post("user_adv", { enabled: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.setMemberAccess).toHaveBeenCalledWith({
      firmId: "org_1",
      provider: "microsoft",
      userId: "user_adv",
      enabled: false,
      updatedByUserId: "user_admin",
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "workspace.member_access",
        firmId: "org_1",
        metadata: { userId: "user_adv", enabled: false },
      }),
    );
  });

  it.each([
    ["a string enabled", { enabled: "false" }],
    ["a missing enabled", {}],
    ["malformed JSON", "{oops"],
  ])("400s on %s", async (_label, body) => {
    const res = await post("user_adv", body);
    expect(res.status).toBe(400);
    expect(mocks.setMemberAccess).not.toHaveBeenCalled();
  });
});
