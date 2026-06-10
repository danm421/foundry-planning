// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSolverMc } from "../use-solver-mc";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function ok(successRate: number) {
  return {
    ok: true,
    json: async () => ({ successRate }),
    text: async () => "",
  } as unknown as Response;
}

describe("useSolverMc", () => {
  it("idle when disabled", () => {
    const { result } = renderHook(() =>
      useSolverMc({
        clientId: "c1", source: "base", mutations: [],
        includeBase: true, enabled: false, nonce: 0,
      }),
    );
    expect(result.current.status).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches working + base when includeBase is true", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(0.8)) // working
      .mockResolvedValueOnce(ok(0.6)); // base
    const { result } = renderHook(() =>
      useSolverMc({
        clientId: "c1", source: "base", mutations: [],
        includeBase: true, enabled: true, nonce: 1,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.workingSuccessRate).toBe(0.8);
    expect(result.current.baseSuccessRate).toBe(0.6);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("working-only run does not refetch base", async () => {
    fetchMock.mockResolvedValueOnce(ok(0.5)); // working only
    const { result } = renderHook(() =>
      useSolverMc({
        clientId: "c1", source: "base", mutations: [],
        includeBase: false, enabled: true, nonce: 2,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.workingSuccessRate).toBe(0.5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces an error status on a failed fetch", async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 500, text: async () => "boom", json: async () => ({}),
    } as unknown as Response);
    const { result } = renderHook(() =>
      useSolverMc({
        clientId: "c1", source: "base", mutations: [],
        includeBase: true, enabled: true, nonce: 1,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("aborted run does not clobber the result of the subsequent run (nonce race)", async () => {
    // First run: deferred — stays in-flight while nonce bumps.
    let resolveFirst!: (v: Response) => void;
    const firstPromise = new Promise<Response>((r) => { resolveFirst = r; });
    fetchMock.mockReturnValueOnce(firstPromise); // consumed by nonce=1 run
    fetchMock.mockResolvedValueOnce(ok(0.99));   // consumed by nonce=2 run

    const baseProps = {
      clientId: "c1", source: "base", mutations: [] as [],
      includeBase: false, enabled: true, nonce: 1,
    };
    const { result, rerender } = renderHook(
      (props: typeof baseProps) => useSolverMc(props),
      { initialProps: baseProps },
    );

    // nonce=2 launches a second run; its fetch resolves immediately to 0.99.
    rerender({ ...baseProps, nonce: 2 });

    // Wait for the second run to land.
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.workingSuccessRate).toBe(0.99);

    // Now the first (aborted) run resolves late — the guard must drop it.
    resolveFirst(ok(0.5));
    await Promise.resolve(); // flush microtasks

    // State must remain the second run's value.
    expect(result.current.workingSuccessRate).toBe(0.99);
    expect(result.current.status).toBe("ready");
  });
});
