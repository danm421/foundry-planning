// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useLayoutEffect } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, render, renderHook } from "@testing-library/react";
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
    const { result } = renderHook(() =>
      useSolverFullProjection({
        clientId: "c1",
        source: "base",
        mutations: NO_MUTATIONS,
        enabled: false,
      }),
    );
    expect(result.current.loading).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // `renderHook`'s `act()` flushes the passive effect below synchronously
  // before `result.current` is ever read, so a `renderHook`-based assertion
  // can't distinguish `useState(false)` from `useState(enabled)` — both read
  // `loading: true` by the time the test observes them. `renderToStaticMarkup`
  // never runs effects at all, so it renders exactly what a caller sees on the
  // very first committed frame (the one FINDING #1 was about): purely the
  // `useState` initializer, before the effect has had any chance to fire.
  function FirstPaintProbe({ enabled }: { enabled: boolean }) {
    const { projection, loading } = useSolverFullProjection({
      clientId: "c1",
      source: "base",
      mutations: NO_MUTATIONS,
      enabled,
    });
    if (loading) return createElement("span", null, "loading");
    if (projection === undefined) return createElement("span", null, "unavailable");
    return createElement("span", null, "ready");
  }

  it("paints as loading, never as unavailable, on the very first frame when enabled", () => {
    const html = renderToStaticMarkup(createElement(FirstPaintProbe, { enabled: true }));
    expect(html).toContain("loading");
  });

  it("paints as unavailable, not loading, on the very first frame when disabled", () => {
    const html = renderToStaticMarkup(createElement(FirstPaintProbe, { enabled: false }));
    expect(html).toContain("unavailable");
  });

  // The scenario that actually happens in solver-chart-panel.tsx: the hook
  // mounts once, while `enabled` is false (the default Estate sub-tab is
  // Charts), and only later flips to `enabled: true` from a click — a state
  // transition on an ALREADY-MOUNTED instance, not a fresh mount. The
  // `useState(enabled)` initialiser above can't help here (it only runs once,
  // at that first false-mount); the fix that matters is the render-time
  // `prevEnabledRef` correction.
  //
  // Capturing `loading` from inside the component's render body (as a naive
  // version of this test first tried) doesn't work: React can invoke a render
  // function more than once for a single commit when a hook calls setState
  // *during* rendering — exactly what the render-time correction does — and
  // none of those extra invocations are ever painted. `useLayoutEffect` fires
  // once per actual COMMIT (i.e. once per frame a browser would have painted),
  // which is the granularity that matters here.
  it("never commits a frame where enabled is true and loading is false", () => {
    const committed: boolean[] = [];
    function TransitionProbe({ enabled }: { enabled: boolean }) {
      const { loading } = useSolverFullProjection({
        clientId: "c1",
        source: "base",
        mutations: NO_MUTATIONS,
        enabled,
      });
      useLayoutEffect(() => {
        committed.push(loading);
      });
      return null;
    }
    const { rerender } = render(createElement(TransitionProbe, { enabled: false }));
    expect(committed).toEqual([false]);
    rerender(createElement(TransitionProbe, { enabled: true }));
    // An effect-only fix commits `false` first (the stale value, painted),
    // then corrects to `true` on a second commit once the passive effect
    // fires — `committed` would read `[false, false, true]`. The render-time
    // fix folds the correction into the SAME commit as the `enabled` flip, so
    // `false` is never committed a second time.
    expect(committed).toEqual([false, true]);
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
