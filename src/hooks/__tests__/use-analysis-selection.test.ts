// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAnalysisSelection } from "../use-analysis-selection";

const CLIENT = "client-1";
const STORAGE_KEY = `portfolio-analysis:${CLIENT}:selected`;

function installLocalStorageShim() {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: shim });
}

const available = new Set(["category:retirement", "category:taxable", "asset_class:eq", "account:gone"]);
const defaults = new Set(["category:retirement", "category:taxable"]);

describe("useAnalysisSelection", () => {
  beforeEach(() => installLocalStorageShim());

  it("falls back to defaults when nothing is stored", () => {
    const { result } = renderHook(() => useAnalysisSelection(CLIENT, available, defaults));
    expect(result.current.selectedKeys).toEqual(defaults);
  });

  it("reads the stored set on mount and drops stale keys", () => {
    window.localStorage.setItem(
      STORAGE_KEY, JSON.stringify(["asset_class:eq", "account:gone-forever"]),
    );
    const { result } = renderHook(() => useAnalysisSelection(CLIENT, available, defaults));
    // "account:gone-forever" is not in availableKeys → dropped.
    expect(result.current.selectedKeys).toEqual(new Set(["asset_class:eq"]));
  });

  it("persists on add", () => {
    const { result } = renderHook(() => useAnalysisSelection(CLIENT, available, defaults));
    act(() => result.current.add(["asset_class:eq"]));
    expect(result.current.selectedKeys.has("asset_class:eq")).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toContain("asset_class:eq");
  });

  it("persists on remove and clear", () => {
    const { result } = renderHook(() => useAnalysisSelection(CLIENT, available, defaults));
    act(() => result.current.remove("category:retirement"));
    expect(result.current.selectedKeys.has("category:retirement")).toBe(false);
    act(() => result.current.clear());
    expect(result.current.selectedKeys.size).toBe(0);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
  });
});
