// src/domain/copilot/tools/__tests__/whatif-estate-tax.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClientData } from "@/engine/types";

const loadEffectiveTree = vi.fn();
const runProjectionWithEvents = vi.fn();
const verifyClientAccess = vi.fn();

vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: (...a: unknown[]) => loadEffectiveTree(...a),
}));
vi.mock("@/engine", () => ({
  runProjection: vi.fn(),
  runProjectionWithEvents: (...a: unknown[]) => runProjectionWithEvents(...a),
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

const ORDERING = (total: number) => ({
  firstDecedent: "client" as const,
  firstDeath: { totalTaxesAndExpenses: total } as never,
  totals: { federal: total, state: 0, admin: 0, total },
});

beforeEach(() => {
  vi.clearAllMocks();
  verifyClientAccess.mockResolvedValue({ ok: true, permission: "edit", firmId: "firm-1", access: "own" });
  loadEffectiveTree.mockResolvedValue({
    effectiveTree: { id: "tree" } as unknown as ClientData,
    warnings: [],
    resolutionContext: undefined,
  });
});

describe("whatif_estate_tax", () => {
  it("default mode: reports first/second death events + today's hypothetical estate tax", async () => {
    runProjectionWithEvents.mockReturnValue({
      years: [],
      firstDeathEvent: { totalTaxesAndExpenses: 250_000 },
      secondDeathEvent: { totalTaxesAndExpenses: 1_100_000 },
      todayHypotheticalEstateTax: {
        year: 2026,
        primaryFirst: ORDERING(900_000),
        spouseFirst: ORDERING(950_000),
      },
    });
    const tool = toolByName("whatif_estate_tax");
    const out = JSON.parse(
      String(await tool.invoke({ clientId: "client-1", scenarioId: "base" })),
    );
    expect(loadEffectiveTree).toHaveBeenCalledWith("client-1", "firm-1", "base", {});
    expect(out.firstDeath.totalTaxesAndExpenses).toBe(250_000);
    expect(out.secondDeath.totalTaxesAndExpenses).toBe(1_100_000);
    expect(out.today.primaryFirst.total).toBe(900_000);
    expect(out.today.spouseFirst.total).toBe(950_000);
  });

  it("die-in-year-N mode: reads that year's EoY hypothetical estate tax", async () => {
    runProjectionWithEvents.mockReturnValue({
      years: [
        { year: 2040, hypotheticalEstateTax: { year: 2040, primaryFirst: ORDERING(700_000) } },
        { year: 2041, hypotheticalEstateTax: { year: 2041, primaryFirst: ORDERING(720_000) } },
      ],
      todayHypotheticalEstateTax: { year: 2026, primaryFirst: ORDERING(0) },
    });
    const tool = toolByName("whatif_estate_tax");
    const out = JSON.parse(
      String(await tool.invoke({ clientId: "client-1", scenarioId: "base", dieInYear: 2041 })),
    );
    expect(out.dieInYear).toBe(2041);
    expect(out.hypotheticalEstateTax.primaryFirst.total).toBe(720_000);
  });

  it("die-in-year-N with no matching projection year returns a not-found note", async () => {
    runProjectionWithEvents.mockReturnValue({
      years: [{ year: 2040, hypotheticalEstateTax: { year: 2040, primaryFirst: ORDERING(700_000) } }],
      todayHypotheticalEstateTax: { year: 2026, primaryFirst: ORDERING(0) },
    });
    const tool = toolByName("whatif_estate_tax");
    const out = JSON.parse(
      String(await tool.invoke({ clientId: "client-1", scenarioId: "base", dieInYear: 2099 })),
    );
    expect(out.error).toMatch(/2099/);
  });
});
