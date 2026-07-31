import { describe, it, expect, vi, beforeEach } from "vitest";

const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
const selectWhere = vi.fn().mockResolvedValue([{ id: "c1" }]);

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: selectWhere }) }),
    update: () => ({ set: updateSet }),
  },
}));
vi.mock("@/db/schema", () => ({ clients: {} }));
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn().mockResolvedValue("firm-1") }));
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: vi.fn().mockResolvedValue({ firmId: "firm-1", access: "own" }),
}));
vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined),
  authErrorResponse: () => null,
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/clients/cross-firm-audit", () => ({ crossFirmAuditMeta: () => ({}) }));

// Deliberately NOT mocked: `@/lib/scenario/loader` and
// `@/lib/onboarding/step-status`. While the route still imports them this
// suite fails on module resolution — which is the point. The removal of the
// blocker gate is the thing under test, not a side effect of it.
import { POST } from "../finish/route";

const params = Promise.resolve({ id: "c1" });
const req = () =>
  new Request("http://localhost/api/clients/c1/onboarding/finish", { method: "POST" }) as never;

describe("POST /api/clients/[id]/onboarding/finish", () => {
  beforeEach(() => {
    updateSet.mockClear();
    selectWhere.mockResolvedValue([{ id: "c1" }]);
  });

  it("finishes on a client with no data in any step", async () => {
    const res = await POST(req(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.completedAt).toBe("string");
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ onboardingCompletedAt: expect.any(Date) }),
    );
  });

  it("never reports blockers", async () => {
    const res = await POST(req(), { params });
    expect(await res.json()).not.toHaveProperty("blockers");
  });

  it("404s on an unknown client without writing", async () => {
    selectWhere.mockResolvedValue([]);
    const res = await POST(req(), { params });
    expect(res.status).toBe(404);
    expect(updateSet).not.toHaveBeenCalled();
  });
});
