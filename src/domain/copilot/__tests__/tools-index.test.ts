// src/domain/copilot/__tests__/tools-index.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildToolContext } from "../context";
import type { CopilotAuthContext } from "../state";

// Stub the IO/engine deps the read+compute+whatif tools import at module load
// so this assembly test stays a pure unit (no DB, no Azure, no engine run).
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree: vi.fn() }));
vi.mock("@/lib/projection/load-monte-carlo-data", () => ({ loadMonteCarloData: vi.fn() }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn() }));
vi.mock("@/engine", () => ({ runProjection: vi.fn(), runProjectionWithEvents: vi.fn() }));
vi.mock("@/lib/solver/solve-target", () => ({ solveTarget: vi.fn() }));
vi.mock("@/lib/solver/solve-max-spending", () => ({ solveMaxSpending: vi.fn() }));
vi.mock("@/lib/solver/solve-ss-portfolio", () => ({ solveSsClaimAgeByPortfolio: vi.fn() }));
vi.mock("@/engine/scenario/applyChanges", () => ({ applyScenarioChanges: vi.fn() }));
vi.mock("@/engine/what-if/life-insurance-need", () => ({
  runLifeInsuranceWhatIf: vi.fn(),
  survivorEndingPortfolio: vi.fn(),
}));
vi.mock("@/lib/solver/apply-mutations", () => ({ applyMutations: vi.fn() }));

import { buildTools, WRITE_TOOL_NAMES } from "../tools";

const ctx: CopilotAuthContext = { userId: "u1", firmId: "org_A", clientId: "c1", scenarioId: "base" };
const TOOL_CTX = buildToolContext(ctx, "conv-1");

const EXPECTED = [
  // read
  "find_client",
  "client_briefing",
  "list_scenarios",
  "read_detail",
  // compute
  "run_projection",
  "run_monte_carlo",
  "compare_scenarios",
  "explain_report",
  // whatif + solvers
  "whatif_roth",
  "whatif_social_security",
  "whatif_withdrawal",
  "whatif_estate_tax",
  "whatif_life_insurance_need",
  "solve_goal",
  "solve_max_spending",
];

describe("buildTools (Phase 1 assembly)", () => {
  it("returns exactly the 15 named Phase-1 tools", () => {
    const tools = buildTools(TOOL_CTX);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED].sort());
    expect(tools).toHaveLength(15);
  });

  it("has no duplicate tool names", () => {
    const names = buildTools(TOOL_CTX).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("WRITE_TOOL_NAMES is still empty in Phase 1 (no writes until Phase 2)", () => {
    expect(WRITE_TOOL_NAMES instanceof Set).toBe(true);
    expect(WRITE_TOOL_NAMES.size).toBe(0);
  });
});
