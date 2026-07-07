import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMc = vi.fn();
const mockMs = vi.fn();
vi.mock("./monte-carlo", () => ({ getOrComputeMonteCarlo: (...a: unknown[]) => mockMc(...a) }));
vi.mock("./max-spending", () => ({ getOrComputeMaxSpending: (...a: unknown[]) => mockMs(...a) }));

import { warmComparisonCompute } from "./warm-comparison";

beforeEach(() => {
  vi.clearAllMocks();
  mockMc.mockResolvedValue({});
  mockMs.mockResolvedValue({});
});

describe("warmComparisonCompute", () => {
  it("warms MC + max-spend for base and the scenario", async () => {
    await warmComparisonCompute({ clientId: "c1", firmId: "f1", scenarioId: "scn1", targetPoS: 0.9 });
    const mcScns = mockMc.mock.calls.map((c) => (c[0] as { scenarioId: string }).scenarioId).sort();
    const msScns = mockMs.mock.calls.map((c) => (c[0] as { scenarioId: string }).scenarioId).sort();
    expect(mcScns).toEqual(["base", "scn1"]);
    expect(msScns).toEqual(["base", "scn1"]);
    expect((mockMs.mock.calls[0][0] as { targetPoS: number }).targetPoS).toBe(0.9);
  });

  it("does not throw when one compute rejects, and still warms the rest", async () => {
    mockMc.mockRejectedValueOnce(new Error("boom"));
    await expect(
      warmComparisonCompute({ clientId: "c1", firmId: "f1", scenarioId: "scn1", targetPoS: 0.85 }),
    ).resolves.toBeUndefined();
    // 2 MC + 2 max-spend attempted despite the one rejection
    expect(mockMc).toHaveBeenCalledTimes(2);
    expect(mockMs).toHaveBeenCalledTimes(2);
  });
});
