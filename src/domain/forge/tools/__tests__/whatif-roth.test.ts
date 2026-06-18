// src/domain/forge/tools/__tests__/whatif-roth.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClientData, ProjectionYear } from "@/engine/types";

// Mock the IO + engine boundaries so the tool stays a pure unit under test.
const loadEffectiveTree = vi.fn();
const runProjection = vi.fn();
const verifyClientAccess = vi.fn();

vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: (...a: unknown[]) => loadEffectiveTree(...a),
}));
vi.mock("@/engine", () => ({
  runProjection: (...a: unknown[]) => runProjection(...a),
}));
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: (...a: unknown[]) => verifyClientAccess(...a),
}));

import { buildWhatIfTools } from "../whatif";

const CTX = {
  ctx: { userId: "u1", firmId: "firm-1", clientId: "client-1", scenarioId: "base" },
  conversationId: "conv-1",
};

function toolByName(name: string) {
  const t = buildWhatIfTools(CTX).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not built`);
  return t;
}

function fakeTree(): ClientData {
  // Minimal but complete enough for the REAL applyMutations/resolveRefYears
  // (not mocked in this test): they traverse these arrays unconditionally.
  return {
    client: {},
    planSettings: { planStartYear: 2026 },
    accounts: [],
    incomes: [],
    expenses: [],
    savingsRules: [],
    withdrawalStrategy: [],
  } as unknown as ClientData;
}

function projYear(over: Partial<ProjectionYear>): ProjectionYear {
  return {
    year: 2026,
    rothConversions: [],
    taxResult: { flow: { totalTax: 0 } },
    medicare: { totalAnnualCost: 0 },
    ...over,
  } as unknown as ProjectionYear;
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyClientAccess.mockResolvedValue({ ok: true, permission: "edit", firmId: "firm-1", access: "own" });
  loadEffectiveTree.mockResolvedValue({
    effectiveTree: fakeTree(),
    warnings: [],
    resolutionContext: undefined,
  });
});

describe("whatif_roth", () => {
  it("resolves the tree through loadEffectiveTree (never hand-builds ClientData)", async () => {
    runProjection.mockReturnValue([projYear({})]);
    const tool = toolByName("whatif_roth");
    await tool.invoke({ clientId: "client-1", scenarioId: "base", conversions: [] });
    expect(loadEffectiveTree).toHaveBeenCalledWith("client-1", "firm-1", "base", {});
  });

  it("rejects a clientId that does not match the server-derived scope", async () => {
    const tool = toolByName("whatif_roth");
    const out = await tool.invoke({ clientId: "other-client", scenarioId: "base", conversions: [] });
    expect(String(out)).toMatch(/scope|not authorized|access/i);
    expect(loadEffectiveTree).not.toHaveBeenCalled();
  });

  it("regression: transient verifyClientAccess error returns 'try again' message, not a scope denial", async () => {
    // clientId matches ctx.clientId (no scope violation), but verifyClientAccess
    // throws a transient DB error. The old catch-all returned the scope message,
    // misleading the advisor. After the fix, it returns a distinct "try again" message.
    verifyClientAccess.mockRejectedValue(new Error("db down"));
    const tool = toolByName("whatif_roth");
    const out = String(
      await tool.invoke({ clientId: "client-1", scenarioId: "base", conversions: [] }),
    );
    expect(out).toMatch(/try again/i);
    expect(out).not.toMatch(/scope mismatch/i);
    expect(loadEffectiveTree).not.toHaveBeenCalled();
  });

  it("reports gross/taxable per conversion year and Base->Scenario tax + medicare deltas", async () => {
    // Base run: no conversions, $10k tax, $5k medicare.
    // Scenario run: a $40k conversion ($40k taxable), $18k tax, $6k medicare.
    runProjection
      .mockReturnValueOnce([
        projYear({
          year: 2030,
          rothConversions: [],
          taxResult: { flow: { totalTax: 10_000 } } as ProjectionYear["taxResult"],
          medicare: { totalAnnualCost: 5_000 } as ProjectionYear["medicare"],
        }),
      ])
      .mockReturnValueOnce([
        projYear({
          year: 2030,
          rothConversions: [{ id: "rc1", name: "Ladder 2030", gross: 40_000, taxable: 40_000 }],
          taxResult: { flow: { totalTax: 18_000 } } as ProjectionYear["taxResult"],
          medicare: { totalAnnualCost: 6_000 } as ProjectionYear["medicare"],
        }),
      ]);
    const tool = toolByName("whatif_roth");
    const out = JSON.parse(
      String(
        await tool.invoke({
          clientId: "client-1",
          scenarioId: "base",
          conversions: [{ id: "rc1", year: 2030, amount: 40_000, sourceAccountId: "acct-1", destinationAccountId: "acct-roth" }],
        }),
      ),
    );
    expect(out.conversionYears).toEqual([
      { year: 2030, conversions: [{ id: "rc1", name: "Ladder 2030", gross: 40_000, taxable: 40_000 }] },
    ]);
    expect(out.totals.scenarioTax).toBe(18_000);
    expect(out.totals.baseTax).toBe(10_000);
    expect(out.totals.taxDelta).toBe(8_000);
    expect(out.totals.medicareDelta).toBe(1_000);
    // Two runs: base + scenario.
    expect(runProjection).toHaveBeenCalledTimes(2);
  });
});
