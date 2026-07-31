// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { SolverMutation } from "@/lib/solver/types";
import { useSolverFullProjection } from "../use-solver-full-projection";

const NO_MUTATIONS: SolverMutation[] = [];

function jsonResponse(body: unknown) {
  return {
    ok: true,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async () =>
    jsonResponse({ projectionResult: { years: [{ year: 2026 }] } }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useSolverFullProjection", () => {
  it("does not fetch while disabled", async () => {
    renderHook(() =>
      useSolverFullProjection({
        clientId: "c1",
        source: "base",
        mutations: NO_MUTATIONS,
        enabled: false,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("debounces, then POSTs with includeEvents and exposes the projection", async () => {
    const { result } = renderHook(() =>
      useSolverFullProjection({
        clientId: "c1",
        source: "base",
        mutations: NO_MUTATIONS,
        enabled: true,
      }),
    );

    expect(result.current.loading).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/clients/c1/solver/project");
    expect(JSON.parse(String(init.body))).toMatchObject({
      source: "base",
      includeEvents: true,
    });
    expect(result.current.projection).toMatchObject({ years: [{ year: 2026 }] });
    expect(result.current.loading).toBe(false);
  });

  it("clears the projection when the request fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as unknown as Response);
    const { result } = renderHook(() =>
      useSolverFullProjection({
        clientId: "c1",
        source: "base",
        mutations: NO_MUTATIONS,
        enabled: true,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(result.current.projection).toBeUndefined();
    expect(result.current.loading).toBe(false);
  });
});
