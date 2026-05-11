// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
  usePathname: vi.fn(),
}));

import { useCompareState } from "../use-compare-state";

const CLIENT_ID = "client-123";
const PATH = "/clients/client-123/compare";

let pushSpy: ReturnType<typeof vi.fn>;

function setUrl(search: string) {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(search) as unknown as ReturnType<typeof useSearchParams>,
  );
}

// jsdom in this project does not ship a working Storage impl on
// `window.localStorage` (it's an empty object). Install a tiny in-memory
// shim per test so the hook's localStorage writes are observable.
function installLocalStorageShim() {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: shim,
  });
}

describe("useCompareState (array shape)", () => {
  beforeEach(() => {
    pushSpy = vi.fn();
    vi.mocked(useRouter).mockReturnValue({
      push: pushSpy,
      replace: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);
    vi.mocked(usePathname).mockReturnValue(PATH);
    installLocalStorageShim();
  });

  it("reads ?plans= into an ordered array, baselineIndex = 0", () => {
    setUrl("plans=base,sid_a,sid_b");
    const { result } = renderHook(() => useCompareState(CLIENT_ID));
    expect(result.current.plans).toEqual(["base", "sid_a", "sid_b"]);
    expect(result.current.baselineIndex).toBe(0);
  });

  it("falls back to [base, base] when ?plans is missing", () => {
    setUrl("");
    const { result } = renderHook(() => useCompareState(CLIENT_ID));
    expect(result.current.plans).toEqual(["base", "base"]);
  });

  it("setPlanAt(i, ref) replaces the i-th entry and pushes the URL", () => {
    setUrl("plans=base,base");
    const { result } = renderHook(() => useCompareState(CLIENT_ID));
    act(() => result.current.setPlanAt(1, "sid_x"));
    expect(pushSpy).toHaveBeenCalledWith(`${PATH}?plans=base%2Csid_x`);
  });

  it("setPlanAt(i, 'base') normalizes to base token in the URL", () => {
    setUrl("plans=sid_a,sid_b");
    const { result } = renderHook(() => useCompareState(CLIENT_ID));
    act(() => result.current.setPlanAt(0, "base"));
    expect(pushSpy).toHaveBeenCalledWith(`${PATH}?plans=base%2Csid_b`);
  });

  it("addPlan appends base; no-op at length 4", () => {
    setUrl("plans=base,sid_a");
    const { result, rerender } = renderHook(() => useCompareState(CLIENT_ID));
    act(() => result.current.addPlan());
    expect(pushSpy).toHaveBeenLastCalledWith(`${PATH}?plans=base%2Csid_a%2Cbase`);
    setUrl("plans=base,sid_a,sid_b,sid_c");
    rerender();
    pushSpy.mockClear();
    act(() => result.current.addPlan());
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it("removePlanAt removes the entry; no-op at length 2", () => {
    setUrl("plans=base,sid_a,sid_b");
    const { result, rerender } = renderHook(() => useCompareState(CLIENT_ID));
    act(() => result.current.removePlanAt(1));
    expect(pushSpy).toHaveBeenLastCalledWith(`${PATH}?plans=base%2Csid_b`);
    setUrl("plans=base,sid_a");
    rerender();
    pushSpy.mockClear();
    act(() => result.current.removePlanAt(1));
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it("makeBaseline(i) rotates entry i to index 0", () => {
    setUrl("plans=base,sid_a,sid_b");
    const { result } = renderHook(() => useCompareState(CLIENT_ID));
    act(() => result.current.makeBaseline(2));
    expect(pushSpy).toHaveBeenLastCalledWith(`${PATH}?plans=sid_b%2Cbase%2Csid_a`);
  });

  it("mirrors plans to localStorage on every mutation", () => {
    setUrl("plans=base,base");
    const { result } = renderHook(() => useCompareState(CLIENT_ID));
    act(() => result.current.setPlanAt(1, "sid_x"));
    expect(window.localStorage.getItem(`compare:${CLIENT_ID}:plans`)).toBe("base,sid_x");
  });

  it("reads legacy ?left=&right= when ?plans is absent", () => {
    setUrl("left=base&right=sid_legacy");
    const { result } = renderHook(() => useCompareState(CLIENT_ID));
    expect(result.current.plans).toEqual(["base", "sid_legacy"]);
  });
});
