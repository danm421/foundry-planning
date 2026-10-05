import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn() };
});
vi.mock("@/lib/rate-limit", () => ({
  checkProjectionRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  rateLimitErrorResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi.fn().mockResolvedValue({
    ok: true, permission: "edit", firmId: "00000000-0000-4000-8000-000000000099", access: "own",
  }),
}));
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree: vi.fn() }));
vi.mock("@/lib/solver/apply-mutations", () => ({ applyMutations: vi.fn((tree) => tree) }));
vi.mock("@/lib/solver/resolve-technique-mutations", () => ({
  resolveTechniqueMutations: vi.fn((tree) => tree),
}));
// The plan starts in 2025 — a year before the advisor's "now" in these tests.
vi.mock("@/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/engine")>();
  return { ...actual, runProjection: vi.fn(() => [{ year: 2025 }]) };
});
// The solve itself is unit-tested in src/lib/solver; here we assert what the
// route hands it.
vi.mock("@/lib/solver/solve-goal-dedicated-savings", () => ({
  solveGoalDedicatedSavings: vi.fn(() => ({ additionalAnnual: 1200, reachesTarget: true, targetPct: 1 })),
}));

import { POST } from "../route";
import { requireOrgId } from "@/lib/db-helpers";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { solveGoalDedicatedSavings } from "@/lib/solver/solve-goal-dedicated-savings";

const CLIENT_ID = "00000000-0000-4000-8000-000000000001";
const FIRM_ID = "00000000-0000-4000-8000-000000000099";
const VALID_BODY = { source: "base", mutations: [], goalId: "goal-1", accountId: "acct-1" };

function makeRequest(body: unknown) {
  return new Request(`http://localhost/api/clients/${CLIENT_ID}/solver/goal-solve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

const ctx = { params: Promise.resolve({ id: CLIENT_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgId).mockResolvedValue(FIRM_ID);
  vi.mocked(loadEffectiveTree).mockResolvedValue({
    effectiveTree: { client: {}, accounts: [], savingsRules: [], expenses: [] },
    resolutionContext: undefined,
  } as never);
});

describe("POST /api/clients/[id]/solver/goal-solve", () => {
  it("solves in the year the Goals tab sent, so Solve and Apply pick the same savings rule", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, currentYear: 2026 }), ctx as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ additionalAnnual: 1200, reachesTarget: true, targetPct: 1 });
    expect(vi.mocked(solveGoalDedicatedSavings).mock.calls[0][0]).toMatchObject({
      goalId: "goal-1", accountId: "acct-1", currentYear: 2026,
    });
  });

  it("falls back to the plan's first projection year when an older tab sends no year", async () => {
    await POST(makeRequest(VALID_BODY), ctx as never);
    expect(vi.mocked(solveGoalDedicatedSavings).mock.calls[0][0].currentYear).toBe(2025);
  });

  it.each([2026.5, 1800, "2026"])("refuses a currentYear of %s", async (currentYear) => {
    const res = await POST(makeRequest({ ...VALID_BODY, currentYear }), ctx as never);
    expect(res.status).toBe(400);
    expect(solveGoalDedicatedSavings).not.toHaveBeenCalled();
  });
});
