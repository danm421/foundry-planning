import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/compute-cache/monte-carlo", () => ({
  getOrComputeMonteCarlo: vi.fn(),
}));
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree: vi.fn() }));
vi.mock("@/lib/projection/load-monte-carlo-data", () => ({
  loadMonteCarloData: vi.fn(),
}));
vi.mock("@/lib/solver/apply-mutations", () => ({
  applyMutations: vi.fn((tree) => tree),
}));
vi.mock("@/lib/solver/resolve-technique-mutations", () => ({
  resolveTechniqueMutations: vi.fn((tree) => tree),
}));
vi.mock("@/lib/compute-cache/hash", () => ({
  hashMonteCarloInputs: vi.fn(() => "HASH"),
}));
vi.mock("@/engine", () => ({
  createReturnEngine: vi.fn(() => ({})),
  runMonteCarlo: vi.fn(async () => ({ successRate: 0.42 })),
}));
vi.mock("@/engine/projection", () => ({
  runProjectionWithEvents: vi.fn(() => ({ years: [{ year: 2026 }] })),
}));
vi.mock("@/lib/compute-cache/assemble-monte-carlo-result", () => ({
  assembleMonteCarloResult: vi.fn(() => ({
    payload: { summary: {}, deterministic: [] },
    raw: { successRate: 0.42 },
    meta: { planStartYear: 2026 },
  })),
}));

// Chainable db mock: select→from→where resolves via `selectWhere` (reconfigurable);
// insert/delete are no-ops we can assert were called.
const selectRows: unknown[] = [];
const selectWhere = vi.fn(() => Promise.resolve(selectRows));
const insertValues = vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) });
const deleteWhere = vi.fn().mockResolvedValue(undefined);
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => selectWhere() }) }),
    insert: () => ({ values: insertValues }),
    delete: () => ({ where: deleteWhere }),
  },
}));
vi.mock("@/db/schema", () => ({ solverMcCache: {} }));

import { getOrComputeSolverMc, getOrComputeSolverMcReport } from "./solver-mc";
import { getOrComputeMonteCarlo } from "@/lib/compute-cache/monte-carlo";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";
import { runMonteCarlo } from "@/engine";

beforeEach(() => {
  vi.clearAllMocks();
  selectRows.length = 0;
  selectWhere.mockImplementation(() => Promise.resolve(selectRows));
  vi.mocked(loadEffectiveTree).mockResolvedValue({
    effectiveTree: { client: {} } as never,
    warnings: [],
    resolutionContext: undefined,
  } as never);
  vi.mocked(loadMonteCarloData).mockResolvedValue({
    indices: [], correlation: [], accountMixes: [],
    startingLiquidBalance: 0, seed: 1, requiredMinimumAssetLevel: 0,
  });
});

describe("getOrComputeSolverMc", () => {
  it("no mutations → delegates to the persistent scenario cache", async () => {
    vi.mocked(getOrComputeMonteCarlo).mockResolvedValue({
      raw: { successRate: 0.91 },
    } as never);

    const out = await getOrComputeSolverMc({
      clientId: "c1", firmId: "f1", source: "base", mutations: [],
    });

    expect(out).toEqual({ successRate: 0.91 });
    expect(getOrComputeMonteCarlo).toHaveBeenCalledWith({
      clientId: "c1", firmId: "f1", scenarioId: "base", forceRefresh: undefined,
    });
    expect(runMonteCarlo).not.toHaveBeenCalled();
  });

  it("edited tree, cache miss → runs MC server-side and stores the result", async () => {
    const out = await getOrComputeSolverMc({
      clientId: "c1", firmId: "f1", source: "base",
      mutations: [{ kind: "retirement-age", person: "client", age: 67 } as never],
    });

    expect(out).toEqual({ successRate: 0.42 });
    expect(runMonteCarlo).toHaveBeenCalledOnce();
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "c1", firmId: "f1", inputHash: "HASH", successRate: 0.42,
      }),
    );
  });

  it("edited tree, cache hit → returns stored value without running MC", async () => {
    selectRows.push({ inputHash: "HASH", successRate: 0.77 });

    const out = await getOrComputeSolverMc({
      clientId: "c1", firmId: "f1", source: "base",
      mutations: [{ kind: "retirement-age", person: "client", age: 67 } as never],
    });

    expect(out).toEqual({ successRate: 0.77 });
    expect(runMonteCarlo).not.toHaveBeenCalled();
  });

  it("forceRefresh → ignores the cached row and recomputes", async () => {
    selectRows.push({ inputHash: "HASH", successRate: 0.77 });

    const out = await getOrComputeSolverMc({
      clientId: "c1", firmId: "f1", source: "base",
      mutations: [{ kind: "retirement-age", person: "client", age: 67 } as never],
      forceRefresh: true,
    });

    expect(out).toEqual({ successRate: 0.42 });
    expect(runMonteCarlo).toHaveBeenCalledOnce();
  });

  it("cache read throws → fails open, computes fresh result", async () => {
    selectWhere.mockImplementation(() => { throw new Error("DB down"); });

    const out = await getOrComputeSolverMc({
      clientId: "c1", firmId: "f1", source: "base",
      mutations: [{ kind: "retirement-age", person: "client", age: 67 } as never],
    });

    expect(out).toEqual({ successRate: 0.42 });
    expect(runMonteCarlo).toHaveBeenCalledOnce();
  });
});

describe("getOrComputeSolverMcReport", () => {
  it("no mutations → returns the full persistent-cache result", async () => {
    vi.mocked(getOrComputeMonteCarlo).mockResolvedValue({
      payload: { summary: {} }, raw: { successRate: 0.91 }, meta: {},
    } as never);

    const out = await getOrComputeSolverMcReport({
      clientId: "c1", firmId: "f1", source: "base", mutations: [],
    });

    expect(out.raw.successRate).toBe(0.91);
    expect(runMonteCarlo).not.toHaveBeenCalled();
  });

  it("edited tree, cache miss → runs MC, assembles, and stores result + successRate", async () => {
    const out = await getOrComputeSolverMcReport({
      clientId: "c1", firmId: "f1", source: "base",
      mutations: [{ kind: "retirement-age", person: "client", age: 67 } as never],
    });

    expect(out.raw.successRate).toBe(0.42);
    expect(runMonteCarlo).toHaveBeenCalledOnce();
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "c1", firmId: "f1", inputHash: "HASH",
        successRate: 0.42, result: expect.objectContaining({ raw: expect.anything() }),
      }),
    );
  });

  it("edited tree, row has stored result → returns it without running MC", async () => {
    selectRows.push({ inputHash: "HASH", successRate: 0.77, result: { payload: {}, raw: { successRate: 0.77 }, meta: {} } });

    const out = await getOrComputeSolverMcReport({
      clientId: "c1", firmId: "f1", source: "base",
      mutations: [{ kind: "retirement-age", person: "client", age: 67 } as never],
    });

    expect(out.raw.successRate).toBe(0.77);
    expect(runMonteCarlo).not.toHaveBeenCalled();
  });

  it("edited tree, legacy row (result null) → recomputes to backfill", async () => {
    selectRows.push({ inputHash: "HASH", successRate: 0.77, result: null });

    const out = await getOrComputeSolverMcReport({
      clientId: "c1", firmId: "f1", source: "base",
      mutations: [{ kind: "retirement-age", person: "client", age: 67 } as never],
    });

    expect(out.raw.successRate).toBe(0.42);
    expect(runMonteCarlo).toHaveBeenCalledOnce();
  });
});
