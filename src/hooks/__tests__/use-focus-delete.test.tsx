// @vitest-environment jsdom
import { StrictMode } from "react";
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useFocusDelete } from "@/hooks/use-focus-delete";

function deferred() {
  let resolve!: (ok: boolean) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<boolean>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useFocusDelete", () => {
  it("is idle and never runs when there is nothing to delete", async () => {
    const onFocusClose = vi.fn();
    const { result } = renderHook(() => useFocusDelete(null, onFocusClose));
    await act(async () => {});
    expect(result.current).toBe(false);
    expect(onFocusClose).not.toHaveBeenCalled();
  });

  it("is busy from the first render and clears only after the delete resolves true", async () => {
    const d = deferred();
    const run = vi.fn(() => d.promise);
    const onFocusClose = vi.fn();
    const { result } = renderHook(() => useFocusDelete(run, onFocusClose));
    expect(result.current).toBe(true);
    await act(async () => {});
    expect(result.current).toBe(true);
    await act(async () => d.resolve(true));
    expect(result.current).toBe(false);
    // Success is the close hook's job, not this one's.
    expect(onFocusClose).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reports failed once on a false result and stays busy", async () => {
    const onFocusClose = vi.fn();
    const { result } = renderHook(() => useFocusDelete(async () => false, onFocusClose));
    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith("failed"));
    expect(onFocusClose).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(true);
  });

  it("reports failed on a rejected promise", async () => {
    const onFocusClose = vi.fn();
    renderHook(() => useFocusDelete(() => Promise.reject(new Error("network")), onFocusClose));
    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith("failed"));
    expect(onFocusClose).toHaveBeenCalledTimes(1);
  });

  it("runs once under StrictMode and still reports", async () => {
    const run = vi.fn(async () => false);
    const onFocusClose = vi.fn();
    renderHook(() => useFocusDelete(run, onFocusClose), { wrapper: StrictMode });
    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith("failed"));
    expect(run).toHaveBeenCalledTimes(1);
    expect(onFocusClose).toHaveBeenCalledTimes(1);
  });

  it("calls the latest onFocusClose, not the mount-time one", async () => {
    const d = deferred();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useFocusDelete(() => d.promise, cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });
    await act(async () => d.resolve(false));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("failed");
  });

  it("calls nothing after the host unmounts mid-delete", async () => {
    const d = deferred();
    const onFocusClose = vi.fn();
    const { unmount } = renderHook(() => useFocusDelete(() => d.promise, onFocusClose));
    unmount();
    await act(async () => d.resolve(false));
    expect(onFocusClose).not.toHaveBeenCalled();
  });
});
