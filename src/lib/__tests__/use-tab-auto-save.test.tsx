// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTabAutoSave, type SaveResult } from "../use-tab-auto-save";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useTabAutoSave", () => {
  it("applies tab change immediately when form is not dirty (no save call)", async () => {
    const saveAsync = vi.fn<() => Promise<SaveResult>>();
    const apply = vi.fn<(id: string) => void>();
    const { result } = renderHook(() =>
      useTabAutoSave({ isDirty: false, canSave: true, saveAsync }),
    );

    await act(async () => {
      await result.current.interceptTabChange("next", apply);
    });

    expect(saveAsync).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledWith("next");
    expect(result.current.saving).toBe(false);
    expect(result.current.saveError).toBeNull();
  });

  it("saves then applies tab change when dirty + valid", async () => {
    const saveAsync = vi.fn<() => Promise<SaveResult>>().mockResolvedValue({ ok: true });
    const apply = vi.fn<(id: string) => void>();
    const { result } = renderHook(() =>
      useTabAutoSave({ isDirty: true, canSave: true, saveAsync }),
    );

    await act(async () => {
      await result.current.interceptTabChange("beneficiaries", apply);
    });

    expect(saveAsync).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith("beneficiaries");
    expect(result.current.saving).toBe(false);
    expect(result.current.saveError).toBeNull();
  });

  it("blocks tab change and calls onBlocked when invalid + dirty", async () => {
    const saveAsync = vi.fn<() => Promise<SaveResult>>();
    const apply = vi.fn<(id: string) => void>();
    const onBlocked = vi.fn();
    const { result } = renderHook(() =>
      useTabAutoSave({ isDirty: true, canSave: false, saveAsync, onBlocked }),
    );

    await act(async () => {
      await result.current.interceptTabChange("cash_value", apply);
    });

    expect(saveAsync).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledOnce();
  });

  it("blocks tab change and surfaces error when save fails", async () => {
    const saveAsync = vi
      .fn<() => Promise<SaveResult>>()
      .mockResolvedValue({ ok: false, error: "Name already in use" });
    const apply = vi.fn<(id: string) => void>();
    const { result } = renderHook(() =>
      useTabAutoSave({ isDirty: true, canSave: true, saveAsync }),
    );

    await act(async () => {
      await result.current.interceptTabChange("schedule", apply);
    });

    expect(saveAsync).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled();
    expect(result.current.saveError).toBe("Name already in use");
  });

  it("translates a thrown error from saveAsync into saveError", async () => {
    const saveAsync = vi
      .fn<() => Promise<SaveResult>>()
      .mockRejectedValue(new Error("network down"));
    const apply = vi.fn<(id: string) => void>();
    const { result } = renderHook(() =>
      useTabAutoSave({ isDirty: true, canSave: true, saveAsync }),
    );

    await act(async () => {
      await result.current.interceptTabChange("next", apply);
    });

    expect(apply).not.toHaveBeenCalled();
    expect(result.current.saveError).toBe("network down");
  });

  it("drops a second tab-change call while a save is in flight", async () => {
    const d = deferred<SaveResult>();
    const saveAsync = vi.fn<() => Promise<SaveResult>>().mockReturnValue(d.promise);
    const apply = vi.fn<(id: string) => void>();
    const { result } = renderHook(() =>
      useTabAutoSave({ isDirty: true, canSave: true, saveAsync }),
    );

    let first!: Promise<void>;
    act(() => {
      first = result.current.interceptTabChange("a", apply);
    });
    // saving is true now
    expect(result.current.saving).toBe(true);

    // second call while in flight — should be dropped immediately
    await act(async () => {
      await result.current.interceptTabChange("b", apply);
    });
    expect(saveAsync).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled();

    // Resolve the first save
    await act(async () => {
      d.resolve({ ok: true });
      await first;
    });
    expect(apply).toHaveBeenCalledWith("a");
    expect(apply).not.toHaveBeenCalledWith("b");
  });

  it("clears save error on demand", async () => {
    const saveAsync = vi
      .fn<() => Promise<SaveResult>>()
      .mockResolvedValue({ ok: false, error: "boom" });
    const apply = vi.fn<(id: string) => void>();
    const { result } = renderHook(() =>
      useTabAutoSave({ isDirty: true, canSave: true, saveAsync }),
    );

    await act(async () => {
      await result.current.interceptTabChange("next", apply);
    });
    expect(result.current.saveError).toBe("boom");

    act(() => result.current.clearSaveError());
    expect(result.current.saveError).toBeNull();
  });
});
