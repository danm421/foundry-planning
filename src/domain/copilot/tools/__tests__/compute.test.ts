// src/domain/copilot/tools/__tests__/compute.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CopilotAuthContext } from "../../context";

// firmId is re-derived server-side via requireOrgId, never trusted from the
// model. Pin it to the ctx firmId so the loader-arg assertions are stable.
vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: vi.fn(async () => "firmA"),
}));
vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: vi.fn(),
}));
vi.mock("@/engine", async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...actual, runProjectionWithEvents: vi.fn() };
});
vi.mock("@/lib/compute-cache/monte-carlo", () => ({
  getOrComputeMonteCarlo: vi.fn(),
}));
vi.mock("@/engine/monteCarlo/summarize", () => ({
  summarizeMonteCarlo: vi.fn(),
}));
vi.mock("../../guards", () => {
  class ForbiddenScopeError extends Error {
    constructor(detail: string) {
      super(`forbidden_scope: ${detail}`);
    }
  }
  return {
    ForbiddenScopeError,
    assertClientReadable: vi.fn(async (ctx: CopilotAuthContext, clientId: string) => {
      if (clientId !== ctx.clientId) throw new ForbiddenScopeError(`client ${clientId}`);
    }),
  };
});

import { buildComputeTools } from "../compute";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjectionWithEvents } from "@/engine";
import { getOrComputeMonteCarlo } from "@/lib/compute-cache/monte-carlo";
import { summarizeMonteCarlo } from "@/engine/monteCarlo/summarize";

const ctx: CopilotAuthContext = {
  userId: "u1",
  firmId: "firmA",
  clientId: "client-1",
  scenarioId: "scn-1",
};
const toolCtx = { ctx, conversationId: "conv-1" };

function tool(name: string) {
  const t = buildComputeTools(toolCtx).find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

beforeEach(() => vi.clearAllMocks());

function fakeYear(year: number) {
  return {
    year,
    ages: { client: 60 + (year - 2025) },
    income: { total: 100_000 },
    expenses: { total: 80_000 },
    netCashFlow: 20_000,
    portfolioAssets: { total: 2_000_000 },
    taxResult: { totalTax: 18_000 },
    medicare: { totalAnnualCost: 0, totalIrmaaSurcharge: 0 },
  };
}

describe("compute.ts — run_projection", () => {
  it("rejects an out-of-scope clientId before resolving the tree", async () => {
    await expect(
      tool("run_projection").invoke({ clientId: "client-OTHER" }),
    ).rejects.toThrow("forbidden_scope");
    expect(loadEffectiveTree).not.toHaveBeenCalled();
  });

  it("resolves the tree via loadEffectiveTree (never hand-built) and reports bracket tax", async () => {
    vi.mocked(loadEffectiveTree).mockResolvedValue({
      effectiveTree: {
        planSettings: { taxEngineMode: "bracket" },
        taxYearRows: [{ year: 2025 }],
      },
      warnings: [],
      resolutionContext: {},
    } as unknown as Awaited<ReturnType<typeof loadEffectiveTree>>);
    vi.mocked(runProjectionWithEvents).mockReturnValue({
      years: [fakeYear(2025), fakeYear(2026)],
    } as unknown as ReturnType<typeof runProjectionWithEvents>);

    const out = JSON.parse(
      (await tool("run_projection").invoke({ clientId: "client-1" })) as string,
    );
    expect(loadEffectiveTree).toHaveBeenCalledWith("client-1", "firmA", "scn-1", {});
    expect(out.taxGrounded).toBe(true);
    expect(out.years).toHaveLength(2);
    expect(out.years[0].totalTax).toBe(18_000);
  });

  it("flags taxGrounded=false when the engine fell back to flat mode", async () => {
    vi.mocked(loadEffectiveTree).mockResolvedValue({
      effectiveTree: { planSettings: { taxEngineMode: "flat" }, taxYearRows: [] },
      warnings: [],
      resolutionContext: {},
    } as unknown as Awaited<ReturnType<typeof loadEffectiveTree>>);
    vi.mocked(runProjectionWithEvents).mockReturnValue({
      years: [fakeYear(2025)],
    } as unknown as ReturnType<typeof runProjectionWithEvents>);

    const out = JSON.parse(
      (await tool("run_projection").invoke({ clientId: "client-1" })) as string,
    );
    expect(out.taxGrounded).toBe(false);
  });
});

describe("compute.ts — run_monte_carlo", () => {
  it("rejects an out-of-scope clientId before computing", async () => {
    await expect(
      tool("run_monte_carlo").invoke({ clientId: "client-OTHER" }),
    ).rejects.toThrow("forbidden_scope");
    expect(getOrComputeMonteCarlo).not.toHaveBeenCalled();
  });

  it("returns the canonical 1000-trial success rate + percentiles", async () => {
    vi.mocked(loadEffectiveTree).mockResolvedValue({
      effectiveTree: {
        client: { firstName: "Jane", lastName: "Doe", dateOfBirth: "1965-01-01" },
        planSettings: { planStartYear: 2025 },
      },
      warnings: [],
      resolutionContext: {},
    } as unknown as Awaited<ReturnType<typeof loadEffectiveTree>>);
    vi.mocked(getOrComputeMonteCarlo).mockResolvedValue({
      payload: {},
      raw: { trialsRun: 1000, aborted: false } as never,
      meta: { startingLiquidBalance: 1_200_000 },
    } as unknown as Awaited<ReturnType<typeof getOrComputeMonteCarlo>>);
    vi.mocked(summarizeMonteCarlo).mockReturnValue({
      requestedTrials: 1000,
      trialsRun: 1000,
      aborted: false,
      successRate: 0.92,
      failureRate: 0.08,
      ending: { p50: 1_500_000 },
      byYear: [],
    } as unknown as ReturnType<typeof summarizeMonteCarlo>);

    const out = JSON.parse(
      (await tool("run_monte_carlo").invoke({ clientId: "client-1" })) as string,
    );
    expect(getOrComputeMonteCarlo).toHaveBeenCalledWith({
      clientId: "client-1",
      firmId: "firmA",
      scenarioId: "scn-1",
    });
    expect(out.available).toBe(true);
    expect(out.successRate).toBe(0.92);
    expect(out.trialsRun).toBe(1000);
  });

  it("degrades (available:false) when the sim throws or returns no result", async () => {
    vi.mocked(loadEffectiveTree).mockResolvedValue({
      effectiveTree: {
        client: { firstName: "Jane", lastName: "Doe" },
        planSettings: { planStartYear: 2025 },
      },
      warnings: [],
      resolutionContext: {},
    } as unknown as Awaited<ReturnType<typeof loadEffectiveTree>>);
    vi.mocked(getOrComputeMonteCarlo).mockRejectedValue(new Error("compute-cache miss"));

    const out = JSON.parse(
      (await tool("run_monte_carlo").invoke({ clientId: "client-1" })) as string,
    );
    expect(out.available).toBe(false);
    expect(summarizeMonteCarlo).not.toHaveBeenCalled();
  });
});
