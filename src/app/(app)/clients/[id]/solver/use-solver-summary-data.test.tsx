// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSolverSummaryData } from "./use-solver-summary-data";
import type { ProjectionYear } from "@/engine";

const fetchMock = vi.fn();
const years = [{ year: 2025 }] as unknown as ProjectionYear[];
const workingTree = { client: {} } as never;
const base = {
  clientId: "c1", source: "base" as const, mutations: [],
  years, workingTree, clientName: "Ada", spouseName: null, mcSuccessRate: 0.9, enabled: true,
  baseClientData: { client: {} } as never,
  baseProjection: years,
};

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("useSolverSummaryData", () => {
  it("builds a base context with no fetch for tax", () => {
    const { result } = renderHook(() => useSolverSummaryData({ ...base, activeSummary: "tax" }));
    expect(result.current.context.years).toBe(years);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the LI inventory when the LI summary is active", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ policies: [{ accountId: "p1" }] }) } as Response);
    const { result } = renderHook(() => useSolverSummaryData({ ...base, activeSummary: "lifeInsurance" }));
    await waitFor(() => expect(result.current.context.lifeInsurance).toBeTruthy());
    expect(result.current.context.lifeInsurance?.policies[0]?.accountId).toBe("p1");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/solver/li-inventory"), expect.anything());
  });
});
