// src/domain/mcp/__tests__/projection-data.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  buildRunDeps: vi.fn(),
  chargeCompute: vi.fn(),
  getOrComputeMonteCarlo: vi.fn(),
  summarizeMonteCarlo: vi.fn(),
  verifyClientAccessFor: vi.fn(),
}));
vi.mock("../whatif-jobs", () => ({ buildRunDeps: h.buildRunDeps, chargeCompute: h.chargeCompute }));
vi.mock("@/lib/compute-cache/monte-carlo", () => ({ getOrComputeMonteCarlo: h.getOrComputeMonteCarlo }));
vi.mock("@/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/engine")>()),
  summarizeMonteCarlo: h.summarizeMonteCarlo,
}));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccessFor: h.verifyClientAccessFor }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({
  checkMcpRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 1, reset: 0 }),
}));

import { runProjectionWithEvents } from "@/engine";
import { assertWithinSize, buildSections, projectionDataTools, MAX_RESPONSE_CHARS } from "../tools/projection-data";
import { WhatIfValidationError } from "@/lib/whatif/errors";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { IDS, whatIfTree } from "@/lib/whatif/__tests__/fixtures";

const principal: McpPrincipal = { userId: "u1", orgId: "org_1", orgRole: "org:member", scopes: [], tokenSubject: "u1" };
const tool = projectionDataTools[0];

beforeEach(() => {
  h.buildRunDeps.mockReset().mockImplementation(async () => ({ tree: whatIfTree(), now: () => 0 }));
  h.chargeCompute.mockReset().mockResolvedValue(undefined);
  h.getOrComputeMonteCarlo.mockReset().mockResolvedValue({ raw: {}, meta: { startingLiquidBalance: 1 } });
  h.summarizeMonteCarlo.mockReset().mockReturnValue({
    successRate: 0.82,
    byYear: [{ year: 2026 }, { year: 2027 }, { year: 2040 }],
  });
  h.verifyClientAccessFor.mockReset().mockResolvedValue({ ok: true, permission: "view", firmId: "org_1", access: "own" });
});

describe("buildSections", () => {
  const tree = whatIfTree();
  const projection = runProjectionWithEvents(tree);

  it("returns only the sections asked for, inside the year range", () => {
    const out = buildSections(tree, projection, ["cashflow"], { startYear: 2030, endYear: 2032 });
    expect(Object.keys(out)).toEqual(["cashflow"]);
    expect((out.cashflow as { year: number }[]).map((r) => r.year)).toEqual([2030, 2031, 2032]);
  });

  it("lists accounts once and aligns each year's balances to that list", () => {
    const out = buildSections(tree, projection, ["balances"], {}) as {
      balances: { accounts: { id: string }[]; years: { endingValues: number[] }[] };
    };
    expect(out.balances.accounts.map((a) => a.id)).toContain(IDS.k401);
    for (const y of out.balances.years) expect(y.endingValues).toHaveLength(out.balances.accounts.length);
  });

  it("sums each year's Roth conversions in the tax section", () => {
    const out = buildSections(tree, projection, ["tax"], {}) as { tax: { rothConverted: number }[] };
    expect(out.tax.every((r) => typeof r.rothConverted === "number")).toBe(true);
  });

  it("reports death years and net to heirs in the estate section", () => {
    const out = buildSections(tree, projection, ["estate"], {}) as { estate: Record<string, unknown> };
    expect(out.estate).toHaveProperty("firstDeathYear");
    expect(out.estate).toHaveProperty("netToHeirs");
  });
});

describe("get_projection_data", () => {
  it("applies unsaved changes on top of the starting scenario", async () => {
    const base = (await tool.run({ clientId: "c1", sections: ["cashflow"] }, principal)) as { cashflow: { totalIncome: number }[] };
    const changed = (await tool.run(
      { clientId: "c1", sections: ["cashflow"], changes: [{ type: "income_amount", incomeId: IDS.salaryJohn, annualAmount: 0 }] },
      principal,
    )) as { cashflow: { totalIncome: number }[]; changesApplied: number };
    expect(changed.changesApplied).toBe(1);
    expect(changed.cashflow[0].totalIncome).toBeLessThan(base.cashflow[0].totalIncome);
  });

  it("refuses monte_carlo with unsaved changes and points at try_what_if", async () => {
    await expect(
      tool.run(
        { clientId: "c1", sections: ["monte_carlo"], changes: [{ type: "spending_scale", multiplier: 0.9 }] },
        principal,
      ),
    ).rejects.toThrow(/try_what_if with includeMonteCarlo/);
  });

  it("serves monte_carlo for a saved scenario from the cache, inside the year range", async () => {
    const out = (await tool.run(
      { clientId: "c1", sections: ["monte_carlo"], startYear: 2026, endYear: 2030 },
      principal,
    )) as { monteCarlo: { successRate: number; byYear: { year: number }[] } };
    expect(h.getOrComputeMonteCarlo).toHaveBeenCalledWith(expect.objectContaining({ scenarioId: "base", forceRefresh: false }));
    expect(out.monteCarlo.successRate).toBe(0.82);
    expect(out.monteCarlo.byYear.map((r) => r.year)).toEqual([2026, 2027]);
  });
});

describe("assertWithinSize", () => {
  it("refuses a response over the cap, saying how to narrow it", () => {
    expect(() => assertWithinSize({ blob: "x".repeat(MAX_RESPONSE_CHARS) })).toThrow(WhatIfValidationError);
    expect(() => assertWithinSize({ blob: "x".repeat(MAX_RESPONSE_CHARS) })).toThrow(/fewer sections or a shorter year range/);
    expect(() => assertWithinSize({ small: true })).not.toThrow();
  });
});
