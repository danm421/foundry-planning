import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn() };
});
vi.mock("@/lib/db-scoping", () => ({ findClientInFirm: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkProjectionRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  rateLimitErrorResponse: vi.fn(() =>
    new Response("rate limited", { status: 429 }),
  ),
}));
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree: vi.fn() }));
vi.mock("@/lib/life-insurance/load-li-portfolio", () => ({
  DEFAULT_LI_GROWTH: 0.05,
  loadLiProceedsGrowth: vi.fn().mockResolvedValue({ rate: 0.05, mix: [] }),
}));
vi.mock("@/lib/projection/load-monte-carlo-data", () => ({
  loadMonteCarloData: vi.fn().mockResolvedValue({ requiredMinimumAssetLevel: 0 }),
}));
// The pure LiSolved producer is unit-tested elsewhere; here we assert the route
// assembles inputs (working tree, proceeds, assumptions, label) and returns its
// output verbatim.
vi.mock("@/lib/compute-cache/life-insurance", () => ({
  CANONICAL_TRIALS: 250,
  computeLiSolved: vi.fn(),
}));
vi.mock("@/lib/solver/apply-mutations", () => ({
  applyMutations: vi.fn((tree) => ({ ...tree, __mutated: true })),
}));
vi.mock("@/lib/solver/resolve-technique-mutations", () => ({
  resolveTechniqueMutations: vi.fn((tree) => tree),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user_test" }),
}));
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi.fn().mockImplementation(async (clientId: string) => {
    const { findClientInFirm } = await import("@/lib/db-scoping");
    const client = await findClientInFirm(
      clientId,
      "00000000-0000-4000-8000-000000000099",
    );
    return client != null
      ? { ok: true, permission: "edit", firmId: "00000000-0000-4000-8000-000000000099", access: "own" }
      : { ok: false };
  }),
}));

import { POST } from "../route";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { computeLiSolved } from "@/lib/compute-cache/life-insurance";
import { applyMutations } from "@/lib/solver/apply-mutations";

const CLIENT_ID = "00000000-0000-4000-8000-000000000001";
const FIRM_ID = "00000000-0000-4000-8000-000000000099";

const SOLVED = {
  curveRows: [{ year: 2026, clientNeed: 100, spouseNeed: null }],
  mcClient: { status: "solved", faceValue: 500000, achievedScore: 0.9 },
  mcSpouse: null,
  assumptions: { deathYear: 2030, modelPortfolioLabel: "Plan default rate", mcTargetScore: 0.8 },
};

const VALID_ASSUMPTIONS = {
  deathYear: 2030,
  modelPortfolioId: null,
  leaveToHeirsAmount: 1000000,
  livingExpenseAtDeath: 80000,
  payoffLiabilityIds: [],
  mcTargetScore: 0.8,
  coverEstateTaxes: false,
  scenarioRef: "base",
};

const VALID_BODY = {
  source: "base",
  mutations: [],
  assumptions: VALID_ASSUMPTIONS,
  modelPortfolioLabel: "Plan default rate",
};

function makeRequest(body: unknown) {
  return new Request(
    `http://localhost/api/clients/${CLIENT_ID}/solver/life-insurance-summary`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  ) as unknown as import("next/server").NextRequest;
}

const ctx = { params: Promise.resolve({ id: CLIENT_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgId).mockResolvedValue(FIRM_ID);
  vi.mocked(findClientInFirm).mockResolvedValue({ id: CLIENT_ID } as never);
  vi.mocked(loadEffectiveTree).mockResolvedValue({
    effectiveTree: { client: {}, accounts: [] },
    resolutionContext: undefined,
  } as never);
  vi.mocked(computeLiSolved).mockResolvedValue(SOLVED as never);
});

describe("POST /api/clients/[id]/solver/life-insurance-summary", () => {
  it("returns 200 with the computed LiSolved payload", async () => {
    const res = await POST(makeRequest(VALID_BODY), ctx as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(SOLVED);
  });

  it("solves against the mutated working tree", async () => {
    await POST(makeRequest(VALID_BODY), ctx as never);
    expect(applyMutations).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(computeLiSolved).mock.calls[0][0];
    expect((arg.tree as { __mutated?: boolean }).__mutated).toBe(true);
    expect(arg.trials).toBe(250);
    expect(arg.modelPortfolioLabel).toBe("Plan default rate");
    expect(arg.assumptions.deathYear).toBe(2030);
  });

  it("returns 404 when the client is not in the caller's firm", async () => {
    vi.mocked(findClientInFirm).mockResolvedValue(null as never);
    const res = await POST(makeRequest(VALID_BODY), ctx as never);
    expect(res.status).toBe(404);
  });

  it("returns 400 when the body fails schema validation", async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, assumptions: { ...VALID_ASSUMPTIONS, deathYear: "nope" } }),
      ctx as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 500 when the solve throws", async () => {
    vi.mocked(computeLiSolved).mockRejectedValueOnce(new Error("solve boom"));
    const res = await POST(makeRequest(VALID_BODY), ctx as never);
    expect(res.status).toBe(500);
  });
});
