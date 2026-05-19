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
vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: vi.fn(),
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

import { POST } from "../route";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { solveLifeInsuranceNeed } from "@/lib/life-insurance/solve-need";

const CLIENT_ID = "00000000-0000-4000-8000-000000000001";
const FIRM_ID = "00000000-0000-4000-8000-000000000099";

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

const VALID_BODY = {
  deathYear: 2030,
  growthRate: 0.05,
  leaveToHeirsAmount: 1000000,
  finalExpenses: 25000,
  livingExpenseAtDeath: 80000,
  payOffDebtsAtDeath: true,
  mcTargetScore: 0.8,
};

function mockTree(filingStatus: string) {
  return {
    client: { filingStatus },
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
    expect(body.spouse).not.toBeNull();
    expect(body.spouse.projection).toEqual([{ year: 2026 }, { year: 2027 }]);
    expect(solveLifeInsuranceNeed).toHaveBeenCalledTimes(2);
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

  it("returns 404 when the client is not in the caller's firm", async () => {
    vi.mocked(findClientInFirm).mockResolvedValue(null as never);
    const res = await POST(makeRequest(VALID_BODY), ctx as never);
    expect(res.status).toBe(404);
  });

  it("returns 400 when the body fails schema validation", async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, growthRate: 5 }),
      ctx as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 500 when the solver throws", async () => {
    vi.mocked(solveLifeInsuranceNeed).mockImplementationOnce(() => {
      throw new Error("solver boom");
    });
    const res = await POST(makeRequest(VALID_BODY), ctx as never);
    expect(res.status).toBe(500);
  });
});
