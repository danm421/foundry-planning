// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAnchorRect } from "../use-anchor-rect";

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("useAnchorRect", () => {
  it("resolves an anchor already in the DOM", () => {
    const el = document.createElement("div");
    el.setAttribute("data-forge-anchor", "target-1");
    document.body.appendChild(el);
    const { result } = renderHook(() => useAnchorRect("target-1"));
    expect(result.current.status).toBe("found");
    expect(result.current.element).toBe(el);
  });

  it("resolves an anchor that mounts asynchronously", async () => {
    const { result } = renderHook(() => useAnchorRect("late"));
    expect(result.current.status).toBe("resolving");
    await act(async () => {
      const el = document.createElement("button");
      el.setAttribute("data-forge-anchor", "late");
      document.body.appendChild(el);
      await Promise.resolve();
    });
    expect(result.current.status).toBe("found");
  });

  it("reports missing after the timeout when the anchor never appears", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAnchorRect("ghost", { timeoutMs: 1000 }));
    expect(result.current.status).toBe("resolving");
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    expect(result.current.status).toBe("missing");
  });

  it("is idle when anchorId is null", () => {
    const { result } = renderHook(() => useAnchorRect(null));
    expect(result.current.status).toBe("idle");
    expect(result.current.element).toBeNull();
  });
});
