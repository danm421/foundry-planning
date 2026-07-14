import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return {
    ...actual,
    requireOrgId: vi.fn(),
  };
});
vi.mock("@/lib/db-scoping", () => ({
  findClientInFirm: vi.fn(),
}));
// The route gained a projection rate-limit guard (audit F11); let it pass so
// tests don't hit the real shared Upstash budget (nondeterministic once spent).
vi.mock("@/lib/rate-limit", () => ({
  checkProjectionRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  rateLimitErrorResponse: vi.fn(),
}));
vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: vi.fn(),
}));
vi.mock("@/lib/solver/apply-mutations", () => ({
  applyMutations: vi.fn((tree) => tree),
}));
vi.mock("@/lib/solver/resolve-technique-mutations", () => ({
  resolveTechniqueMutations: vi.fn((tree) => tree),
}));
vi.mock("@/lib/life-insurance/solve-need", () => ({
  solveLifeInsuranceNeed: vi.fn(() => ({
    status: "solved",
    faceValue: 500000,
    achievedEndingPortfolio: 1000000,
  })),
}));
vi.mock("@/engine/what-if/life-insurance-need", () => ({
  runLifeInsuranceWhatIf: vi.fn(() => [{ year: 2026 }, { year: 2027 }]),
}));

// Phase 1b: routes gate via verifyClientAccess → auth() from @clerk/nextjs/server.
// Mock it so the staff-scope check is a no-op (undefined orgRole ⇒ non-staff ⇒
// access turns purely on the firm-scoped clients query the test already drives).
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user_test" }),
}));
// Phase 1b: verifyClientAccess now owns the client-in-firm gate (replaces
// findClientInFirm). Delegate to the already-mocked findClientInFirm so tests
// that set findClientInFirm → null still exercise the 404 path.
vi.mock("@/lib/clients/authz", () => ({
  // verifyClientAccess is now 1-arg. Source the firm from the test's FIRM_ID
  // (inlined — vi.mock is hoisted above the const) and return the object shape;
  // tests that set findClientInFirm → null still drive the 404 path.
  verifyClientAccess: vi.fn().mockImplementation(async (clientId: string) => {
    const { findClientInFirm } = await import("@/lib/db-scoping");
    const client = await findClientInFirm(clientId, "00000000-0000-4000-8000-000000000099");
    return client != null
      ? { ok: true, permission: "edit", firmId: "00000000-0000-4000-8000-000000000099", access: "own" }
      : { ok: false };
  }),
}));

import { POST } from "../route";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { solveLifeInsuranceNeed } from "@/lib/life-insurance/solve-need";

const CLIENT_ID = "00000000-0000-4000-8000-000000000001";
const FIRM_ID = "00000000-0000-4000-8000-000000000099";
const SCENARIO_ID = "00000000-0000-4000-8000-0000000000aa";

function makeRequest(body: unknown) {
  return new Request(
    `http://localhost/api/clients/${CLIENT_ID}/life-insurance/solve`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  ) as unknown as import("next/server").NextRequest;
}

const ctx = { params: Promise.resolve({ id: CLIENT_ID }) };

const ASSUMPTIONS = {
  deathYear: 2030,
  modelPortfolioId: null,
  leaveToHeirsAmount: 1000000,
  livingExpenseAtDeath: 80000,
  payoffLiabilityIds: [],
  mcTargetScore: 0.8,
};

// Live-solver envelope: source + unsaved mutations wrap the assumptions.
const VALID_BODY = {
  source: "base",
  mutations: [],
  assumptions: ASSUMPTIONS,
};

function mockTree(filingStatus: string, spouseDob: string | null = "1970-06-15") {
  return {
    client: { filingStatus, spouseDob },
    accounts: [],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgId).mockResolvedValue(FIRM_ID);
  vi.mocked(findClientInFirm).mockResolvedValue({ id: CLIENT_ID } as never);
  vi.mocked(solveLifeInsuranceNeed).mockReturnValue({
    status: "solved",
    faceValue: 500000,
    achievedEndingPortfolio: 1000000,
  });
  vi.mocked(loadEffectiveTree).mockResolvedValue({
    effectiveTree: mockTree("married_joint"),
    warnings: [],
  } as never);
});

describe("POST /api/clients/[id]/life-insurance/solve", () => {
  it("returns 200 with client + spouse cases for a married plan", async () => {
    const res = await POST(makeRequest(VALID_BODY), ctx as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isMarried).toBe(true);
    expect(body.client.faceValue).toBe(500000);
    expect(body.client.projection).toEqual([{ year: 2026 }, { year: 2027 }]);
    expect(body.client.estateTaxAddend).toBe(0);
    expect(body.spouse).not.toBeNull();
    expect(body.spouse.projection).toEqual([{ year: 2026 }, { year: 2027 }]);
    expect(body.spouse.estateTaxAddend).toBe(0);
    expect(solveLifeInsuranceNeed).toHaveBeenCalledTimes(2);
  });

  it("attaches an existing-coverage breakdown to each case", async () => {
    const res = await POST(makeRequest(VALID_BODY), ctx as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.client.existingPolicies)).toBe(true);
    expect(typeof body.client.existingCoverageTotal).toBe("number");
  });

  it("returns spouse: null for a single filer", async () => {
    vi.mocked(loadEffectiveTree).mockResolvedValue({
      effectiveTree: mockTree("single"),
      warnings: [],
    } as never);
    const res = await POST(makeRequest(VALID_BODY), ctx as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isMarried).toBe(false);
    expect(body.spouse).toBeNull();
    expect(solveLifeInsuranceNeed).toHaveBeenCalledTimes(1);
  });

  it("returns spouse: null for a married filer with no spouseDob (F5: avoids the spouse-solve crash)", async () => {
    vi.mocked(loadEffectiveTree).mockResolvedValue({
      effectiveTree: mockTree("married_joint", null),
      warnings: [],
    } as never);
    const res = await POST(makeRequest(VALID_BODY), ctx as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Without a spouseDob the spouse case can't be built; treat the plan as
    // single rather than attempting (and crashing) the spouse solve.
    expect(body.isMarried).toBe(false);
    expect(body.spouse).toBeNull();
    expect(solveLifeInsuranceNeed).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when the client is not in the caller's firm", async () => {
    vi.mocked(findClientInFirm).mockResolvedValue(null as never);
    const res = await POST(makeRequest(VALID_BODY), ctx as never);
    expect(res.status).toBe(404);
  });

  it("returns 400 when the body fails schema validation", async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, assumptions: { ...ASSUMPTIONS, deathYear: "not-a-year" } }),
      ctx as never,
    );
    expect(res.status).toBe(400);
  });

  it("solves the source scenario + mutations, not the hardcoded base case", async () => {
    const res = await POST(
      makeRequest({ source: SCENARIO_ID, mutations: [], assumptions: ASSUMPTIONS }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    // The edited plan's scenario id drives the tree load — NOT "base".
    expect(loadEffectiveTree).toHaveBeenCalledWith(CLIENT_ID, FIRM_ID, SCENARIO_ID, {});
    // Live mutations are applied before solving.
    expect(applyMutations).toHaveBeenCalled();
  });

  it("defaults source to base when omitted (back-compat)", async () => {
    const res = await POST(makeRequest({ assumptions: ASSUMPTIONS }), ctx as never);
    expect(res.status).toBe(200);
    expect(loadEffectiveTree).toHaveBeenCalledWith(CLIENT_ID, FIRM_ID, "base", {});
  });

  it("returns 500 when the solver throws", async () => {
    vi.mocked(solveLifeInsuranceNeed).mockImplementationOnce(() => {
      throw new Error("solver boom");
    });
    const res = await POST(makeRequest(VALID_BODY), ctx as never);
    expect(res.status).toBe(500);
  });
});
