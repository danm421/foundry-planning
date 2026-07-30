// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { usePendingEdits } from "../use-pending-edits";

type Owner =
  | { kind: "family_member"; familyMemberId: string; percent: number }
  | { kind: "gifted_away"; recipient: { kind: "family_member" | "entity"; id: string }; percent: number };

interface Row { id: string; value: string; name: string; owners?: Owner[] }

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

  // Additive test (not part of the original brief). "drops the pending value
  // once fresh props agree with it" above only asserts on the MERGED output,
  // which looks correct whether the pending key was actually removed or merely
  // retained-but-coincidentally-equal to what the server sent. This test tells
  // those two cases apart by checking what happens on the NEXT, genuinely
  // different server value: if the pending key was truly dropped on agreement,
  // this new value shows through; if it was only retained, the stale value
  // keeps winning forever.
  it("actually drops the pending key on agreement, not just a coincidentally-equal merge", async () => {
    const save = vi.fn().mockResolvedValue(true);
    const { result, rerender } = renderHook(({ rows }) => usePendingEdits(rows), {
      initialProps: { rows: ROWS },
    });
    await act(async () => { await result.current.apply("a", { value: "999" }, save); });
    expect(result.current.rows[0].value).toBe("999");

    // Server agrees — the point at which the pending key should be dropped.
    rerender({ rows: [{ id: "a", value: "999", name: "A" }, ROWS[1]] });
    await waitFor(() => expect(result.current.rows[0].value).toBe("999"));

    // A LATER, genuinely different server value.
    rerender({ rows: [{ id: "a", value: "777", name: "A" }, ROWS[1]] });
    await waitFor(() => expect(result.current.rows[0].value).toBe("777"));
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

  // Reference-typed field, flat variant: a JSON round-trip always produces a
  // fresh object identity, so `===` reconciliation can never drop this key —
  // it would stay pinned to the optimistic value even after the server
  // catches up, and every later, genuinely different server value would be
  // invisible. See use-pending-edits.ts `sameFieldValue`.
  it("reconciles an array-of-objects field by value, not reference (flat owners)", async () => {
    const save = vi.fn().mockResolvedValue(true);
    const pendingOwners: Owner[] = [{ kind: "family_member", familyMemberId: "fm-1", percent: 100 }];
    const { result, rerender } = renderHook(({ rows }) => usePendingEdits(rows), {
      initialProps: { rows: ROWS },
    });
    await act(async () => {
      await result.current.apply("a", { owners: pendingOwners }, save);
    });
    expect(result.current.rows[0].owners).toEqual(pendingOwners);

    // Server agrees: same value, but a FRESH identity (JSON round-trip), not
    // the same object reference — this is exactly what a real props refresh
    // produces and exactly what `===` cannot see through.
    const agreeing: Owner[] = JSON.parse(JSON.stringify(pendingOwners));
    rerender({ rows: [{ ...ROWS[0], owners: agreeing }, ROWS[1]] });
    await waitFor(() => expect(result.current.rows[0].owners).toEqual(agreeing));

    // A LATER, genuinely different server value must show through — proving
    // the pending key was actually dropped on agreement, not merely retained
    // and coincidentally equal.
    const different: Owner[] = [{ kind: "family_member", familyMemberId: "fm-2", percent: 50 }];
    rerender({ rows: [{ ...ROWS[0], owners: different }, ROWS[1]] });
    await waitFor(() => expect(result.current.rows[0].owners).toEqual(different));
  });

  // Nested variant: `gifted_away` nests `recipient: { kind, id }` a level
  // below the array element itself. Not redundant with the flat case above —
  // a compare that only walks one level into each array element (see mutation
  // M-B in the report) passes the flat test but still strands this one.
  it("reconciles a nested gifted_away owner by value, not reference", async () => {
    const save = vi.fn().mockResolvedValue(true);
    const pendingOwners: Owner[] = [
      { kind: "gifted_away", recipient: { kind: "family_member", id: "fm-3" }, percent: 100 },
    ];
    const { result, rerender } = renderHook(({ rows }) => usePendingEdits(rows), {
      initialProps: { rows: ROWS },
    });
    await act(async () => {
      await result.current.apply("a", { owners: pendingOwners }, save);
    });
    expect(result.current.rows[0].owners).toEqual(pendingOwners);

    const agreeing: Owner[] = JSON.parse(JSON.stringify(pendingOwners));
    rerender({ rows: [{ ...ROWS[0], owners: agreeing }, ROWS[1]] });
    await waitFor(() => expect(result.current.rows[0].owners).toEqual(agreeing));

    const different: Owner[] = [
      { kind: "gifted_away", recipient: { kind: "entity", id: "ent-1" }, percent: 100 },
    ];
    rerender({ rows: [{ ...ROWS[0], owners: different }, ROWS[1]] });
    await waitFor(() => expect(result.current.rows[0].owners).toEqual(different));
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

// T-A: `sameFieldValue` fails silently on NaN and on non-plain objects.
// Separate local fixture types rather than widening the shared `Row` above —
// the 11 tests in the `describe("usePendingEdits")` block above stay
// textually unchanged.
interface NumericRow { id: string; rate: number }
interface DateRow { id: string; ts: Date }

describe("sameFieldValue silent-compare gaps (T-A)", () => {
  it("reconciles a NaN-valued field once the server agrees (Object.is, not ===)", async () => {
    const save = vi.fn().mockResolvedValue(true);
    const rows: NumericRow[] = [{ id: "a", rate: 1 }, { id: "b", rate: 2 }];
    const { result, rerender } = renderHook(({ rows }) => usePendingEdits(rows), {
      initialProps: { rows },
    });
    await act(async () => { await result.current.apply("a", { rate: NaN }, save); });
    expect(result.current.rows[0].rate).toBe(NaN);

    // Server agrees (also NaN) — the point at which the pending key should be
    // dropped. `a === b` is false for NaN/NaN, so a naive compare would never
    // see this as agreement and would strand the field forever.
    rerender({ rows: [{ id: "a", rate: NaN }, rows[1]] });
    await waitFor(() => expect(result.current.rows[0].rate).toBe(NaN));

    // A LATER, genuinely different server value must show through — proving
    // the pending key was actually dropped on agreement, not merely retained
    // and coincidentally equal (same trap the owners discriminator test above
    // guards against).
    rerender({ rows: [{ id: "a", rate: 42 }, rows[1]] });
    await waitFor(() => expect(result.current.rows[0].rate).toBe(42));
  });

  it("keeps a Date-valued field pending when the server sends a DIFFERENT Date", async () => {
    const save = vi.fn().mockResolvedValue(true);
    const original = new Date("2020-01-01T00:00:00Z");
    const optimistic = new Date("2024-06-15T00:00:00Z");
    const rows: DateRow[] = [{ id: "a", ts: original }, { id: "b", ts: original }];
    const { result, rerender } = renderHook(({ rows }) => usePendingEdits(rows), {
      initialProps: { rows },
    });
    await act(async () => { await result.current.apply("a", { ts: optimistic }, save); });
    expect(result.current.rows[0].ts).toBe(optimistic);

    // Server sends a DIFFERENT Date. `Object.keys(new Date())` is `[]` for
    // both, so a naive key-wise compare would call them equal, drop the
    // pending key, and silently revert to the stale server value — the
    // mirror-image bug this task also closes. The safe answer is "not equal":
    // keep showing the optimistic value.
    const serverDifferent = new Date("2021-05-05T00:00:00Z");
    rerender({ rows: [{ id: "a", ts: serverDifferent }, rows[1]] });
    expect(result.current.rows[0].ts).toBe(optimistic);
  });
});
