// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";
import type { SolverMutation } from "@/lib/solver/types";
import {
  useSolverDraft,
  solverDraftKey,
  mutationMapFromDraft,
  type SolverDraft,
  type SolverAccountMix,
} from "../use-solver-draft";

const RET_AGE: SolverMutation = { kind: "retirement-age", person: "client", age: 62 };
const SCALE: SolverMutation = { kind: "living-expense-scale", multiplier: 0.9 };

/** Drives the draft hook with local state the way the workspace does: the caller
 *  owns the mutation array + seed + mixes, and onRestore writes them back. */
function useHarness(
  clientId = "client-1",
  userId = "user-1",
  source = "base",
  initial: SolverMutation[] = [],
) {
  const [mutations, setMutations] = useState<SolverMutation[]>(initial);
  const [solvedSeed, setSolvedSeed] = useState<number | null>(null);
  const [mixes, setMixes] = useState<Map<string, SolverAccountMix[]>>(() => new Map());
  const [ready, setReady] = useState(false);
  useSolverDraft({
    clientId,
    userId,
    source,
    mutations,
    solvedSeed,
    savingsAccountMixes: mixes,
    onRestore: (draft: SolverDraft) => {
      setMutations(draft.mutations);
      if (draft.solvedSeed != null) setSolvedSeed(draft.solvedSeed);
      if (draft.savingsAccountMixes.length > 0) setMixes(new Map(draft.savingsAccountMixes));
    },
    onReady: () => setReady(true),
  });
  return { mutations, setMutations, solvedSeed, mixes, ready };
}

beforeEach(() => {
  localStorage.clear();
});

describe("useSolverDraft", () => {
  it("persists mutations to localStorage under a client+user+source-scoped key", () => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.setMutations([RET_AGE]));
    const raw = localStorage.getItem(solverDraftKey("client-1", "user-1", "base"));
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.v).toBe(1);
    expect(parsed.draft.mutations).toHaveLength(1);
    expect(parsed.draft.mutations[0].kind).toBe("retirement-age");
  });

  it("restores a saved draft on mount — mutations, seed, and mixes", () => {
    localStorage.setItem(
      solverDraftKey("client-1", "user-1", "base"),
      JSON.stringify({
        v: 1,
        draft: {
          mutations: [RET_AGE, SCALE],
          solvedSeed: 12345,
          savingsAccountMixes: [["acct-x", [{ assetClassId: "eq", weight: 1 }]]],
        },
      }),
    );
    const { result } = renderHook(() => useHarness());
    expect(result.current.mutations.map((m) => m.kind)).toEqual([
      "retirement-age",
      "living-expense-scale",
    ]);
    expect(result.current.solvedSeed).toBe(12345);
    expect(result.current.mixes.get("acct-x")).toEqual([{ assetClassId: "eq", weight: 1 }]);
    expect(result.current.ready).toBe(true);
  });

  it("removes the key when the mutation set empties (Reset / resolve)", () => {
    const key = solverDraftKey("client-1", "user-1", "base");
    const { result } = renderHook(() => useHarness());
    act(() => result.current.setMutations([RET_AGE]));
    expect(localStorage.getItem(key)).toBeTruthy();
    act(() => result.current.setMutations([]));
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("ignores a draft written under a different schema version", () => {
    localStorage.setItem(
      solverDraftKey("client-1", "user-1", "base"),
      JSON.stringify({ v: 999, draft: { mutations: [RET_AGE], solvedSeed: null, savingsAccountMixes: [] } }),
    );
    const { result } = renderHook(() => useHarness());
    expect(result.current.mutations).toHaveLength(0);
  });

  it("does not restore a draft saved under a different source (base vs scenario)", () => {
    localStorage.setItem(
      solverDraftKey("client-1", "user-1", "scenario-X"),
      JSON.stringify({ v: 1, draft: { mutations: [RET_AGE], solvedSeed: null, savingsAccountMixes: [] } }),
    );
    // Mount against the base source — the scenario-X draft must not leak in.
    const { result } = renderHook(() => useHarness("client-1", "user-1", "base"));
    expect(result.current.mutations).toHaveLength(0);
  });

  it("does not restore a draft saved under a different client", () => {
    localStorage.setItem(
      solverDraftKey("other-client", "user-1", "base"),
      JSON.stringify({ v: 1, draft: { mutations: [RET_AGE], solvedSeed: null, savingsAccountMixes: [] } }),
    );
    const { result } = renderHook(() => useHarness("client-1", "user-1", "base"));
    expect(result.current.mutations).toHaveLength(0);
  });

  it("treats an empty stored mutation set as no draft", () => {
    localStorage.setItem(
      solverDraftKey("client-1", "user-1", "base"),
      JSON.stringify({ v: 1, draft: { mutations: [], solvedSeed: 7, savingsAccountMixes: [] } }),
    );
    const { result } = renderHook(() => useHarness());
    expect(result.current.mutations).toHaveLength(0);
    expect(result.current.solvedSeed).toBeNull();
  });

  it("survives corrupt JSON in storage without throwing, and still signals ready", () => {
    localStorage.setItem(solverDraftKey("client-1", "user-1", "base"), "{not valid json");
    const { result } = renderHook(() => useHarness());
    expect(result.current.mutations).toHaveLength(0);
    expect(result.current.ready).toBe(true);
  });

  it("does not persist when there is no user id, but never blocks (still signals ready)", () => {
    const setSpy = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useHarness("client-1", "", "base"));
    act(() => result.current.setMutations([RET_AGE]));
    expect(result.current.ready).toBe(true);
    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });

  it("mutationMapFromDraft keys by lever (last write per lever wins)", () => {
    const older: SolverMutation = { kind: "retirement-age", person: "client", age: 60 };
    const newer: SolverMutation = { kind: "retirement-age", person: "client", age: 67 };
    const map = mutationMapFromDraft([older, newer, SCALE]);
    expect(map.size).toBe(2);
    expect((map.get("retirement-age:client") as { age: number }).age).toBe(67);
  });
});
