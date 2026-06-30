// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSolverMcReport } from "../use-solver-mc-report";

const fullResult = { payload: { summary: {} }, raw: { successRate: 0.7 }, meta: {} };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => fullResult })) as never);
});

describe("useSolverMcReport", () => {
  it("does not fetch while disabled", () => {
    renderHook(() => useSolverMcReport({
      clientId: "c1", source: "base", mutations: [], enabled: false, nonce: 0,
    }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches with full:true when enabled and exposes the result", async () => {
    const { result } = renderHook(() => useSolverMcReport({
      clientId: "c1", source: "base", mutations: [], enabled: true, nonce: 1,
    }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.result).toEqual(fullResult);
    const body = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.full).toBe(true);
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])
      .toBe("/api/clients/c1/solver/monte-carlo");
  });
});
