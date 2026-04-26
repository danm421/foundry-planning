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

beforeEach(() => {
  pushSpy = vi.fn();
  vi.mocked(useRouter).mockReturnValue({
    push: pushSpy,
  } as unknown as ReturnType<typeof useRouter>);
  vi.mocked(usePathname).mockReturnValue(PATH);
  setUrl("");
  installLocalStorageShim();
});

describe("useCompareState", () => {
  it("defaults left and right to 'base' when params absent", () => {
    setUrl("");
    const { result } = renderHook(() => useCompareState(CLIENT_ID));
    expect(result.current.left).toBe("base");
    expect(result.current.right).toBe("base");
    expect(result.current.toggleSet.size).toBe(0);
  });

  it("reads left/right from URL params", () => {
    setUrl("left=scn-1&right=snap:abc");
    const { result } = renderHook(() => useCompareState(CLIENT_ID));
    expect(result.current.left).toBe("scn-1");
    expect(result.current.right).toBe("snap:abc");
  });

  it("setSide('right', 'scn-1') pushes URL with right=scn-1", () => {
    setUrl("");
    const { result } = renderHook(() => useCompareState(CLIENT_ID));
    act(() => {
      result.current.setSide("right", "scn-1");
    });
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith(`${PATH}?right=scn-1`);
  });

  it("setSide('right', null) removes the param from URL", () => {
    setUrl("right=scn-1");
    const { result } = renderHook(() => useCompareState(CLIENT_ID));
    act(() => {
      result.current.setSide("right", null);
    });
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith(PATH);
  });

  it("setSide('right', 'base') removes the param from URL", () => {
    setUrl("right=scn-1");
    const { result } = renderHook(() => useCompareState(CLIENT_ID));
    act(() => {
      result.current.setSide("right", "base");
    });
    expect(pushSpy).toHaveBeenCalledWith(PATH);
  });

  it("setToggle adds and removes group ids in toggles param", () => {
    setUrl("");
    const { result } = renderHook(() => useCompareState(CLIENT_ID));
    act(() => {
      result.current.setToggle("g1", true);
    });
    expect(pushSpy).toHaveBeenCalledWith(`${PATH}?toggles=g1`);

    pushSpy.mockClear();
    setUrl("toggles=g1,g2");
    const { result: result2 } = renderHook(() => useCompareState(CLIENT_ID));
    act(() => {
      result2.current.setToggle("g1", false);
    });
    expect(pushSpy).toHaveBeenCalledWith(`${PATH}?toggles=g2`);

    // removing the last toggle drops the param entirely
    pushSpy.mockClear();
    setUrl("toggles=g1");
    const { result: result3 } = renderHook(() => useCompareState(CLIENT_ID));
    act(() => {
      result3.current.setToggle("g1", false);
    });
    expect(pushSpy).toHaveBeenCalledWith(PATH);
  });

  it("localStorage write on setSide includes scoped key", () => {
    setUrl("");
    const { result } = renderHook(() => useCompareState(CLIENT_ID));
    act(() => {
      result.current.setSide("left", "scn-7");
    });
    expect(window.localStorage.getItem(`compare:${CLIENT_ID}:left`)).toBe(
      "scn-7",
    );
    act(() => {
      result.current.setSide("right", null);
    });
    expect(window.localStorage.getItem(`compare:${CLIENT_ID}:right`)).toBe(
      "base",
    );
  });

  it("setSide / setToggle keep stable identity across rerenders", () => {
    setUrl("");
    const { result, rerender } = renderHook(() => useCompareState(CLIENT_ID));
    const setSideFirst = result.current.setSide;
    const setToggleFirst = result.current.setToggle;
    setUrl("left=scn-1");
    rerender();
    expect(result.current.setSide).toBe(setSideFirst);
    expect(result.current.setToggle).toBe(setToggleFirst);
  });
});
