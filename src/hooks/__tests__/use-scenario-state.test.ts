// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
  usePathname: vi.fn(),
}));

import { useScenarioState } from "../use-scenario-state";

const CLIENT_ID = "client-123";
const KEY = `scenario:${CLIENT_ID}`;
const PATH = "/clients/client-123/details/family";

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

describe("useScenarioState", () => {
  it("reads scenario param when set", () => {
    setUrl("scenario=abc");
    const { result } = renderHook(() => useScenarioState(CLIENT_ID));
    expect(result.current.scenarioId).toBe("abc");
  });

  it("returns null when scenario param is absent", () => {
    setUrl("");
    const { result } = renderHook(() => useScenarioState(CLIENT_ID));
    expect(result.current.scenarioId).toBeNull();
  });

  it("setScenario(id) pushes new URL and writes localStorage", () => {
    setUrl("");
    const { result } = renderHook(() => useScenarioState(CLIENT_ID));
    act(() => {
      result.current.setScenario("abc");
    });
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith(`${PATH}?scenario=abc`);
    expect(window.localStorage.getItem(KEY)).toBe("abc");
  });

  it("setScenario(null) removes scenario from URL and clears localStorage", () => {
    setUrl("scenario=abc");
    window.localStorage.setItem(KEY, "abc");
    const { result } = renderHook(() => useScenarioState(CLIENT_ID));
    act(() => {
      result.current.setScenario(null);
    });
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith(PATH);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("scopes localStorage key by clientId", () => {
    setUrl("");
    const { result } = renderHook(() => useScenarioState("other-client-456"));
    act(() => {
      result.current.setScenario("xyz");
    });
    expect(window.localStorage.getItem("scenario:other-client-456")).toBe("xyz");
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("preserves other URL params when setting and clearing scenario", () => {
    setUrl("tab=foo&scenario=abc");
    const { result } = renderHook(() => useScenarioState(CLIENT_ID));
    act(() => {
      result.current.setScenario(null);
    });
    expect(pushSpy).toHaveBeenCalledWith(`${PATH}?tab=foo`);

    pushSpy.mockClear();
    setUrl("tab=foo");
    const { result: result2 } = renderHook(() => useScenarioState(CLIENT_ID));
    act(() => {
      result2.current.setScenario("def");
    });
    const url = pushSpy.mock.calls[0][0] as string;
    expect(url.startsWith(`${PATH}?`)).toBe(true);
    const qs = new URLSearchParams(url.slice(PATH.length + 1));
    expect(qs.get("tab")).toBe("foo");
    expect(qs.get("scenario")).toBe("def");
  });

  it("setScenario keeps stable identity when only params change", () => {
    setUrl("");
    const { result, rerender } = renderHook(() => useScenarioState(CLIENT_ID));
    const first = result.current.setScenario;
    // change params via the mock — useSearchParams returns a new instance
    setUrl("scenario=different");
    rerender();
    expect(result.current.setScenario).toBe(first);
  });
});
