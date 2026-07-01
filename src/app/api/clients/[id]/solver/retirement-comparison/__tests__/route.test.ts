// src/app/api/clients/[id]/solver/retirement-comparison/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn(async () => "org_1") }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn(async () => ({ ok: true, firmId: "firm_1" })) }));
vi.mock("@/lib/rate-limit", () => ({
  checkProjectionRateLimit: vi.fn(async () => ({ allowed: true })),
  rateLimitErrorResponse: vi.fn(),
}));
vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: vi.fn(async () => ({
    effectiveTree: {
      planSettings: { planStartYear: 2025, inflationRate: 0.03 },
      client: { dateOfBirth: "1965-01-01", retirementAge: 65 },
      accounts: [],
    },
    resolutionContext: undefined,
  })),
}));
vi.mock("@/lib/solver/apply-mutations", () => ({ applyMutations: vi.fn((t) => t) }));
vi.mock("@/lib/solver/resolve-technique-mutations", () => ({ resolveTechniqueMutations: vi.fn((t) => t) }));
// Projection year needs portfolioAssets so the real builder can call
// liquidPortfolioTotal() without throwing. Minimal but structurally valid.
vi.mock("@/engine", () => ({
  runProjection: vi.fn(() => [
    {
      year: 2025,
      portfolioAssets: {
        taxableTotal: 0,
        cashTotal: 0,
        retirementTotal: 0,
        liquidTotal: 0,
        retirement: {},
      },
      expenses: { taxes: 0 },
    },
  ]),
}));
vi.mock("@/lib/compute-cache/solver-mc", () => ({
  getOrComputeSolverMcReport: vi.fn(async () => ({ payload: { summary: { successRate: 0.9, byYear: [] } } })),
}));
vi.mock("@/lib/compute-cache/max-spending", () => ({ getOrComputeMaxSpending: vi.fn(async () => ({ realAnnualSpend: 120000 })) }));
vi.mock("@/lib/projection/load-monte-carlo-data", () => ({ loadMonteCarloData: vi.fn(async () => ({})) }));
vi.mock("@/lib/solver/solve-max-spending", () => ({ solveMaxSpending: vi.fn(async () => ({ realAnnualSpend: 135000 })) }));
// The real builder runs against the assembled bundles — no mock, proves integration.

import { POST } from "../route";

function req(body: unknown) {
  return new Request("http://x/api/clients/c1/solver/retirement-comparison", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST retirement-comparison", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a non-empty RetirementComparisonPageData with AI omitted", async () => {
    const res = await POST(req({ source: "base", mutations: [] }) as never, { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isEmpty).toBe(false);
    expect(data.showAiSummary).toBe(false);
    expect(data.title).toBe("Retirement Comparison");
    // Success rate present on both sides → the verdict headline references a %.
    expect(data.verdict.headline).toMatch(/%/);
  });

  it("400s on an invalid body", async () => {
    const res = await POST(req({ mutations: "nope" }) as never, { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(400);
  });
});
