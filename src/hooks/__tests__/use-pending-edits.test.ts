// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { usePendingEdits } from "../use-pending-edits";

interface Row { id: string; value: string; name: string }

const ROWS: Row[] = [
  { id: "a", value: "100", name: "A" },
  { id: "b", value: "200", name: "B" },
];

describe("usePendingEdits", () => {
  it("passes rows through untouched when nothing is pending", () => {
    const { result } = renderHook(() => usePendingEdits(ROWS));
    expect(result.current.rows).toEqual(ROWS);
  });

  it("shows the pending value immediately, before the save resolves", async () => {
    let release: (v: boolean) => void = () => {};
    const save = vi.fn(() => new Promise<boolean>((res) => { release = res; }));
    const { result } = renderHook(() => usePendingEdits(ROWS));

    act(() => { void result.current.apply("a", { value: "999" }, save); });
    expect(result.current.rows[0].value).toBe("999");
    // Untouched fields and untouched rows survive.
    expect(result.current.rows[0].name).toBe("A");
    expect(result.current.rows[1]).toEqual(ROWS[1]);

    await act(async () => { release(true); });
  });

  it("rolls the value back when the save fails", async () => {
    const save = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() => usePendingEdits(ROWS));
    await act(async () => { await result.current.apply("a", { value: "999" }, save); });
    expect(result.current.rows[0].value).toBe("100");
  });

  it("rolls back when the save throws", async () => {
    const save = vi.fn().mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => usePendingEdits(ROWS));
    await act(async () => { await result.current.apply("a", { value: "999" }, save); });
    expect(result.current.rows[0].value).toBe("100");
  });

  it("returns the save's own result", async () => {
    const { result } = renderHook(() => usePendingEdits(ROWS));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.apply("a", { value: "9" }, vi.fn().mockResolvedValue(true));
    });
    expect(ok).toBe(true);
  });

  it("drops the pending value once fresh props agree with it", async () => {
    const save = vi.fn().mockResolvedValue(true);
    const { result, rerender } = renderHook(({ rows }) => usePendingEdits(rows), {
      initialProps: { rows: ROWS },
    });
    await act(async () => { await result.current.apply("a", { value: "999" }, save); });
    expect(result.current.rows[0].value).toBe("999");

    const refreshed: Row[] = [{ id: "a", value: "999", name: "A" }, ROWS[1]];
    rerender({ rows: refreshed });
    await waitFor(() => expect(result.current.rows).toEqual(refreshed));
  });

  it("keeps the pending value while the server still disagrees", async () => {
    const save = vi.fn().mockResolvedValue(true);
    const { result, rerender } = renderHook(({ rows }) => usePendingEdits(rows), {
      initialProps: { rows: ROWS },
    });
    await act(async () => { await result.current.apply("a", { value: "999" }, save); });
    // A refresh triggered by something else entirely — the edit has not landed
    // yet, so the optimistic value must not flicker back to the stale one.
    rerender({ rows: [{ id: "a", value: "100", name: "A2" }, ROWS[1]] });
    expect(result.current.rows[0].value).toBe("999");
    expect(result.current.rows[0].name).toBe("A2");
  });

  it("drops pending state for a row that disappears", async () => {
    const save = vi.fn().mockResolvedValue(true);
    const { result, rerender } = renderHook(({ rows }) => usePendingEdits(rows), {
      initialProps: { rows: ROWS },
    });
    await act(async () => { await result.current.apply("a", { value: "999" }, save); });
    rerender({ rows: [ROWS[1]] });
    await waitFor(() => expect(result.current.rows).toEqual([ROWS[1]]));
  });
});
