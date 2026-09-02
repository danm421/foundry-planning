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
// The scenario-name lookup must be ID-AWARE. Returning one fixed name for any
// id made the label assertions blind: baseline and scenario could be wired to
// each other's ids and every expectation below would still pass. `eq` carries
// the value through so `where` can answer per scenario.
vi.mock("@/db/schema", () => ({ scenarios: { id: "id", clientId: "clientId", name: "name" } }));
vi.mock("drizzle-orm", () => ({
  and: (...cs: unknown[]) => ({ cs }),
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));
const SCENARIO_NAMES: Record<string, string> = { s2: "The Baseline", scn1: "The Comparison" };
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (cond: { cs: Array<{ col: unknown; val: unknown }> }) => ({
          limit: async () => {
            const id = cond.cs.find((c) => c.col === "id")?.val as string | undefined;
            const name = id ? SCENARIO_NAMES[id] : undefined;
            return name ? [{ name }] : [];
          },
        }),
      }),
    }),
  },
}));

import { generateRetirementComparisonAi } from "./generate-ai";
import { getOrComputeMaxSpending } from "@/lib/compute-cache/max-spending";

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
      clientId: "c1", firmId: "f1", scenarioId: "scn1", baselineScenarioId: "base",
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

  // The whole point of the baseline work: the prose must be computed against the
  // same left-hand plan the charts draw, not always Base Case.
  it("projects, Monte-Carlos and max-spends the CHOSEN baseline, not always base", async () => {
    await generateRetirementComparisonAi({
      clientId: "c1", firmId: "f1", scenarioId: "scn1", baselineScenarioId: "s2",
      tone: "concise", length: "short", customInstructions: "",
      targetConfidence: 0.85, force: false,
    });
    const mcIds = mockGetOrComputeMonteCarlo.mock.calls.map((c) => (c[0] as { scenarioId: string }).scenarioId);
    expect(mcIds).toEqual(expect.arrayContaining(["s2", "scn1"]));
    expect(mcIds).not.toContain("base");
    const msIds = vi.mocked(getOrComputeMaxSpending).mock.calls.map((c) => c[0].scenarioId);
    expect(msIds).toEqual(expect.arrayContaining(["s2", "scn1"]));
    expect(msIds).not.toContain("base");
    const promptArgs = mockBuildPrompt.mock.calls[0][0] as {
      baselineIsBase: boolean;
      baselineLabel: string;
      scenarioLabel: string;
    };
    expect(promptArgs.baselineIsBase).toBe(false);
    // Distinct names per id: swapping the two sides now reds this pair.
    expect(promptArgs.baselineLabel).toBe("The Baseline");
    expect(promptArgs.scenarioLabel).toBe("The Comparison");
  });
});
