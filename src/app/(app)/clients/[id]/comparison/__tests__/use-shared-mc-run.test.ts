// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSharedMcRun } from "../use-shared-mc-run";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

vi.mock("@/engine", () => ({
  createReturnEngine: vi.fn().mockReturnValue({}),
  runMonteCarlo: vi.fn().mockImplementation(async () => ({
    successRate: 0.85,
    endingLiquidAssets: [],
    byYearLiquidAssetsPerTrial: [],
  })),
  summarizeMonteCarlo: vi.fn().mockReturnValue({ summary: "fake" }),
}));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
});

const makePlan = (id: string): ComparisonPlan =>
  ({
    id,
    index: 0,
    isBaseline: id === "base",
    label: id,
    tree: {
      client: { dateOfBirth: "1970-01-01" },
      planSettings: {},
    } as never,
    result: { years: [{ year: 2026 }] } as never,
    lifetime: {} as never,
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
  }) as ComparisonPlan;

describe("useSharedMcRun", () => {
  it("does not fetch when enabled=false", async () => {
    renderHook(() =>
      useSharedMcRun({ clientId: "c", plans: [makePlan("base"), makePlan("a")], enabled: false }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches once when enabled=true", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        indices: {},
        correlation: {},
        seed: 1,
        accountMixes: [],
        requiredMinimumAssetLevel: 0.9,
        startingLiquidBalance: 1_000_000,
      }),
    });
    const { result } = renderHook(() =>
      useSharedMcRun({ clientId: "c", plans: [makePlan("base"), makePlan("a")], enabled: true }),
    );
    await waitFor(() => expect(result.current.result?.perPlan.length).toBe(2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
