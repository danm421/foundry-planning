import { describe, it, expect, vi, beforeEach } from "vitest";

const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
const selectWhere = vi.fn().mockResolvedValue([{ id: "c1", state: {} }]);

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
vi.mock("@/lib/clients/cross-firm-audit", () => ({
  crossFirmAuditMeta: (_a: unknown, _b: unknown, m: unknown) => m,
}));

// The real route, not a mirror of its schema — a copied schema can drift from
// the endpoint it claims to describe without any test noticing.
import { PATCH } from "../route";

const params = Promise.resolve({ id: "c1" });
function req(body: unknown) {
  return new Request("http://localhost/api/clients/c1/onboarding", {
    method: "PATCH",
    body: JSON.stringify(body),
  }) as never;
}

describe("PATCH /api/clients/[id]/onboarding — assumptionsReviewed", () => {
  beforeEach(() => {
    updateSet.mockClear();
    selectWhere.mockResolvedValue([{ id: "c1", state: {} }]);
  });

  it("persists assumptionsReviewed: true", async () => {
    const res = await PATCH(req({ assumptionsReviewed: true }), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).state.assumptionsReviewed).toBe(true);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        onboardingState: expect.objectContaining({ assumptionsReviewed: true }),
      }),
    );
  });

  it("leaves an existing flag alone when the key is absent", async () => {
    selectWhere.mockResolvedValue([{ id: "c1", state: { assumptionsReviewed: true } }]);
    const res = await PATCH(req({ lastStepVisited: "review" }), { params });
    expect((await res.json()).state.assumptionsReviewed).toBe(true);
  });

  it("still rejects unknown keys", async () => {
    const res = await PATCH(req({ bogus: 1 }), { params });
    expect(res.status).toBe(400);
    expect(updateSet).not.toHaveBeenCalled();
  });
});
