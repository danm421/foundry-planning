import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelectWhere = vi.fn();
const mockInsertOnConflict = vi.fn(() => Promise.resolve());
const mockRunMonteCarlo = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: (...a: unknown[]) => mockSelectWhere(...a) }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => mockInsertOnConflict() }) }),
  },
}));
vi.mock("@/db/schema", () => ({ scenarioComputeCache: {}, scenarios: {} }));
vi.mock("drizzle-orm", () => ({ and: () => ({}), eq: () => ({}) }));
vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: vi.fn(async () => ({
    effectiveTree: {
      client: { firstName: "T", lastName: "U", retirementAge: 65 },
      planSettings: {},
      accounts: [],
      incomes: [],
    },
  })),
}));
vi.mock("@/lib/projection/load-monte-carlo-data", () => ({
  loadMonteCarloData: vi.fn(async () => ({
    indices: [], correlation: [[1]], accountMixes: [],
    startingLiquidBalance: 100, seed: 1, requiredMinimumAssetLevel: 0,
  })),
}));
vi.mock("@/engine/projection", () => ({ runProjectionWithEvents: () => ({ years: [] }) }));
vi.mock("@/engine", () => ({
  runMonteCarlo: (...a: unknown[]) => mockRunMonteCarlo(...a),
  summarizeMonteCarlo: () => ({ successRate: 0.9 }),
  createReturnEngine: () => ({}),
  liquidPortfolioTotal: () => 0,
}));
vi.mock("@/lib/presentations/pages/monte-carlo/build-payload", () => ({
  buildMonteCarloReportPayload: () => ({ summary: { successRate: 0.9 }, histogram: {}, successRates: [], deterministic: [] }),
}));
vi.mock("./hash", () => ({ ENGINE_VERSION: 1, hashMonteCarloInputs: () => "HASH_X" }));

import { getOrComputeMonteCarlo } from "./monte-carlo";

beforeEach(() => {
  vi.clearAllMocks();
  mockRunMonteCarlo.mockResolvedValue({ successRate: 0.9, endingLiquidAssets: [], byYearLiquidAssetsPerTrial: [], trialsRun: 1000, requestedTrials: 1000, successfulTrials: 900, aborted: false });
});

describe("getOrComputeMonteCarlo", () => {
  it("returns the cached payload on a hash HIT without running MC", async () => {
    const cached = { payload: { summary: { successRate: 0.42 } }, raw: {}, meta: {} };
    mockSelectWhere
      .mockResolvedValueOnce([{ id: "scenario-1" }])
      .mockResolvedValueOnce([{ inputHash: "HASH_X", payload: cached }]);
    const res = await getOrComputeMonteCarlo({ clientId: "c1", firmId: "f1", scenarioId: "base" });
    expect(mockRunMonteCarlo).not.toHaveBeenCalled();
    expect(mockInsertOnConflict).not.toHaveBeenCalled();
    expect(res.payload.summary.successRate).toBe(0.42);
  });

  it("runs MC and upserts on a MISS", async () => {
    mockSelectWhere
      .mockResolvedValueOnce([{ id: "scenario-1" }])
      .mockResolvedValueOnce([]);
    const res = await getOrComputeMonteCarlo({ clientId: "c1", firmId: "f1", scenarioId: "base" });
    expect(mockRunMonteCarlo).toHaveBeenCalledOnce();
    expect(mockInsertOnConflict).toHaveBeenCalledOnce();
    expect(res.payload.summary.successRate).toBe(0.9);
    expect(res.raw.trialsRun).toBe(1000);
  });

  it("forceRefresh recomputes even when a row exists", async () => {
    mockSelectWhere.mockResolvedValueOnce([{ id: "scenario-1" }]);
    const res = await getOrComputeMonteCarlo({ clientId: "c1", firmId: "f1", scenarioId: "base", forceRefresh: true });
    expect(mockRunMonteCarlo).toHaveBeenCalledOnce();
    expect(res.payload).toBeTruthy();
  });
});
