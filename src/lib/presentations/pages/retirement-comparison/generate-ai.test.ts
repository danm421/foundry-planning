import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetOrComputeMonteCarlo = vi.fn();
const mockRunMonteCarlo = vi.fn();
const mockBuildPrompt = vi.fn((..._args: unknown[]) => ({ system: "sys", user: "usr" }));

vi.mock("@/lib/compute-cache/monte-carlo", () => ({
  getOrComputeMonteCarlo: (...a: unknown[]) => mockGetOrComputeMonteCarlo(...a),
}));
vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTreeForRef: vi.fn(async () => ({
    effectiveTree: {
      client: { firstName: "T", lastName: "U", spouseName: null, dateOfBirth: "1970-01-01", retirementAge: 65 },
      planSettings: {},
    },
  })),
}));
vi.mock("@/lib/scenario/presentation-refs", () => ({
  resolveScenarioRef: (raw: string) =>
    raw === "base" ? { kind: "base" } : { kind: "scenario", id: raw },
}));
vi.mock("@/engine/projection", () => ({ runProjectionWithEvents: () => ({ years: [] }) }));
// raw MC must NOT be called anymore
vi.mock("@/engine", () => ({
  runMonteCarlo: (...a: unknown[]) => mockRunMonteCarlo(...a),
  summarizeMonteCarlo: () => ({ successRate: 0 }),
  createReturnEngine: () => ({}),
}));
vi.mock("@/lib/projection/load-monte-carlo-data", () => ({ loadMonteCarloData: vi.fn() }));
vi.mock("@/lib/compute-cache/max-spending", () => ({
  getOrComputeMaxSpending: vi.fn(async () => ({ realAnnualSpend: 100 })),
}));
vi.mock("@/lib/scenario/changes", () => ({
  loadScenarioChanges: vi.fn(async () => []),
  loadScenarioToggleGroups: vi.fn(async () => []),
}));
vi.mock("@/lib/scenario/load-panel-data", () => ({ buildTargetNames: () => ({}) }));
vi.mock("@/lib/scenario/scenario-change-describe", () => ({ describeChangeUnit: () => "" }));
vi.mock("./metrics", () => ({ buildRetirementComparisonMetrics: () => ({ kpis: [], matrix: [] }) }));
vi.mock("./ai-prompt", () => ({ buildRetirementComparisonAiPrompt: (...a: unknown[]) => mockBuildPrompt(...a) }));
vi.mock("@/lib/presentations/ai-cache", () => ({
  hashAiRequest: () => "HASH",
  getCachedAnalysis: vi.fn(async () => null),
  setCachedAnalysis: vi.fn(async () => {}),
}));
vi.mock("@/lib/extraction/azure-client", () => ({ callAIExtraction: vi.fn(async () => "  markdown  ") }));
vi.mock("@/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ name: "Scn" }] }) }) }) } }));
vi.mock("@/db/schema", () => ({ scenarios: {} }));
vi.mock("drizzle-orm", () => ({ and: () => ({}), eq: () => ({}) }));

import { generateRetirementComparisonAi } from "./generate-ai";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrComputeMonteCarlo.mockResolvedValue({
    payload: { summary: { successRate: 0.77, ending: { p20: 4242 } } },
    raw: {},
    meta: { startingLiquidBalance: 0 },
  });
});

describe("generateRetirementComparisonAi Monte Carlo routing", () => {
  it("routes MC through the compute cache for base and the scenario (never raw runMonteCarlo)", async () => {
    await generateRetirementComparisonAi({
      clientId: "c1", firmId: "f1", scenarioId: "scn1",
      tone: "concise", length: "short", customInstructions: "",
      targetConfidence: 0.85, force: false,
    });
    expect(mockRunMonteCarlo).not.toHaveBeenCalled();
    const scenarioIds = mockGetOrComputeMonteCarlo.mock.calls.map((c) => (c[0] as { scenarioId: string }).scenarioId);
    expect(scenarioIds).toContain("base");
    expect(scenarioIds).toContain("scn1");
    // downside p20 flows from cached.payload.summary into the prompt
    const promptArgs = mockBuildPrompt.mock.calls[0][0] as { downside?: { baseEndP20: number; scnEndP20: number } };
    expect(promptArgs.downside).toEqual({ baseEndP20: 4242, scnEndP20: 4242 });
  });
});
