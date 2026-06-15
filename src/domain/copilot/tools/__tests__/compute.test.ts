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
vi.mock("@/lib/scenario/load-projection-for-ref", () => ({
  loadProjectionForRef: vi.fn(),
}));
vi.mock("@/components/presentations/registry", () => {
  const cashFlowPage = {
    id: "cashFlow",
    title: "Cash Flow",
    category: "Cash Flow",
    defaultOptions: { drill: false },
    buildData: vi.fn(() => ({ rows: [{ year: 2025, total: 100_000 }], narrative: ["Cash flow is positive."] })),
  };
  const monteCarloPage = {
    id: "monteCarlo",
    title: "Monte Carlo",
    category: "Monte Carlo",
    defaultOptions: {},
    buildData: vi.fn(() => ({ successRate: 0.9 })),
  };
  return { PRESENTATION_PAGES: { cashFlow: cashFlowPage, monteCarlo: monteCarloPage } };
});
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
import { loadProjectionForRef } from "@/lib/scenario/load-projection-for-ref";
import { PRESENTATION_PAGES } from "@/components/presentations/registry";

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
    taxResult: { flow: { totalTax: 18_000 } },
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

  it("degrades (available:false) on a partial cache result with missing raw, without throwing", async () => {
    vi.mocked(loadEffectiveTree).mockResolvedValue({
      effectiveTree: {
        client: { firstName: "Jane", lastName: "Doe" },
        planSettings: { planStartYear: 2025 },
      },
      warnings: [],
      resolutionContext: {},
    } as unknown as Awaited<ReturnType<typeof loadEffectiveTree>>);
    // Stale/partial cached payload: shape never validated → raw is undefined.
    vi.mocked(getOrComputeMonteCarlo).mockResolvedValue({
      payload: {},
      raw: undefined,
    } as unknown as Awaited<ReturnType<typeof getOrComputeMonteCarlo>>);

    const out = JSON.parse(
      (await tool("run_monte_carlo").invoke({ clientId: "client-1" })) as string,
    );
    expect(out.available).toBe(false);
    expect(summarizeMonteCarlo).not.toHaveBeenCalled();
  });
});

function loaded(name: string, endPortfolio: number, totalTax: number, isDoNothing = false) {
  return {
    tree: {},
    scenarioName: name,
    isDoNothing,
    result: {
      years: [
        {
          year: 2025,
          taxResult: { flow: { totalTax: totalTax / 2 } },
          portfolioAssets: { total: 0 },
        },
        {
          year: 2026,
          taxResult: { flow: { totalTax: totalTax / 2 } },
          portfolioAssets: { total: endPortfolio },
        },
      ],
    },
  } as unknown as Awaited<ReturnType<typeof loadProjectionForRef>>;
}

describe("compute.ts — compare_scenarios", () => {
  it("rejects an out-of-scope clientId before loading either side", async () => {
    await expect(
      tool("compare_scenarios").invoke({
        clientId: "client-OTHER",
        left: "base",
        right: "scn-1",
      }),
    ).rejects.toThrow("forbidden_scope");
    expect(loadProjectionForRef).not.toHaveBeenCalled();
  });

  it("loads two projections via loadProjectionForRef and diffs them", async () => {
    vi.mocked(loadProjectionForRef)
      .mockResolvedValueOnce(loaded("Base case", 2_000_000, 400_000))
      .mockResolvedValueOnce(loaded("Roth ladder", 2_300_000, 360_000));

    const out = JSON.parse(
      (await tool("compare_scenarios").invoke({
        clientId: "client-1",
        left: "base",
        right: "scn-roth",
      })) as string,
    );
    expect(loadProjectionForRef).toHaveBeenCalledTimes(2);
    expect(out.left.scenarioName).toBe("Base case");
    expect(out.right.scenarioName).toBe("Roth ladder");
    expect(out.delta.endingPortfolio).toBe(300_000);
    expect(out.delta.lifetimeTax).toBe(-40_000);
  });

  it("supports the do-nothing counterfactual ref", async () => {
    vi.mocked(loadProjectionForRef)
      .mockResolvedValueOnce(loaded("Do nothing (no plan)", 1_500_000, 500_000, true))
      .mockResolvedValueOnce(loaded("Base case", 2_000_000, 400_000));

    await tool("compare_scenarios").invoke({
      clientId: "client-1",
      left: "do-nothing",
      right: "base",
    });
    expect(loadProjectionForRef).toHaveBeenNthCalledWith(1, "client-1", "firmA", {
      kind: "do-nothing",
    });
  });
});

describe("compute.ts — explain_report", () => {
  it("rejects an out-of-scope clientId", async () => {
    await expect(
      tool("explain_report").invoke({ clientId: "client-OTHER", pageId: "cashFlow" }),
    ).rejects.toThrow("forbidden_scope");
  });

  it("enumerates the available pages at runtime when no pageId is given", async () => {
    const out = JSON.parse(
      (await tool("explain_report").invoke({ clientId: "client-1" })) as string,
    );
    expect(out.availablePages.map((p: { id: string }) => p.id).sort()).toEqual([
      "cashFlow",
      "monteCarlo",
    ]);
  });

  it("builds the page data via PRESENTATION_PAGES[pageId].buildData and returns narrative", async () => {
    vi.mocked(loadEffectiveTree).mockResolvedValue({
      effectiveTree: {
        client: { firstName: "Jane", lastName: "Doe", spouseName: "John" },
        planSettings: {},
      },
      warnings: [],
      resolutionContext: {},
    } as unknown as Awaited<ReturnType<typeof loadEffectiveTree>>);
    vi.mocked(runProjectionWithEvents).mockReturnValue({
      years: [{ year: 2025 } as never],
    } as unknown as ReturnType<typeof runProjectionWithEvents>);

    const out = JSON.parse(
      (await tool("explain_report").invoke({ clientId: "client-1", pageId: "cashFlow" })) as string,
    );
    expect(PRESENTATION_PAGES.cashFlow.buildData).toHaveBeenCalled();
    expect(out.pageId).toBe("cashFlow");
    expect(out.data.rows[0].total).toBe(100_000);
    expect(out.narrative).toEqual(["Cash flow is positive."]);
  });

  it("returns an error payload for an unknown pageId (does not throw)", async () => {
    const out = JSON.parse(
      (await tool("explain_report").invoke({ clientId: "client-1", pageId: "nope" })) as string,
    );
    expect(out.error).toMatch(/unknown page/i);
  });

  it("marks a page that needs unloaded context (monteCarlo) as unavailable without building it", async () => {
    const out = JSON.parse(
      (await tool("explain_report").invoke({ clientId: "client-1", pageId: "monteCarlo" })) as string,
    );
    expect(out.unavailable).toBe(true);
    expect(PRESENTATION_PAGES.monteCarlo.buildData).not.toHaveBeenCalled();
    // No projection load happens for an unavailable page.
    expect(loadEffectiveTree).not.toHaveBeenCalled();
  });
});
