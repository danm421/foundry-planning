"use client";

// NOTE: localStorage is one-way write only — it's a debugging/restore
// breadcrumb scoped per client, not a source of truth. The URL is the source
// of truth and the hook deliberately does not read localStorage on mount.

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { MAX_PLANS } from "@/lib/comparison/series-palette";

const MIN_PLANS = 2;

/**
 * Reads/writes the compare-panel URL params:
 *   - `plans=<ref1,ref2,...refN>`     (preferred; 2..MAX_PLANS entries; each ref is "base"|sid|"snap:<id>")
 *   - `left=<sid|snap:<id>|"base">`   (legacy; mapped to plans[0] when ?plans is absent)
 *   - `right=<sid|snap:<id>|"base">`  (legacy; mapped to plans[1] when ?plans is absent)
 *   - `toggles=g1,g2`                 (comma-separated; right side only at parse time)
 *
 * Returns the ordered `plans` array plus a `Set<string>` of toggle group ids
 * and stable mutators that round-trip through the URL and mirror to
 * localStorage scoped by clientId.
 *
 * The hook also re-exposes legacy `left` / `right` / `setSide` shims so the
 * pre-multi-scenario call sites (compare-panel, snapshot-banner, etc.) keep
 * compiling until they're rewritten in later tasks of this plan.
 */
export interface UseCompareStateResult {
  /** Ordered plan refs, length 2..MAX_PLANS. */
  plans: string[];
  /** Always 0 in Phase 1 — exposed for future per-plan baseline reassignment. */
  baselineIndex: number;
  setPlanAt: (i: number, ref: string | null) => void;
  addPlan: () => void;
  removePlanAt: (i: number) => void;
  makeBaseline: (i: number) => void;
  toggleSet: Set<string>;
  setToggle: (groupId: string, on: boolean) => void;
  /** @deprecated Use `plans[0]`. */
  left: string;
  /** @deprecated Use `plans[1]`. */
  right: string;
  /**
   * @deprecated Use `setPlanAt(0|1, ref)`. Retained so the
   * pre-multi-scenario pages compile while they're being migrated.
   */
  setSide: (side: "left" | "right", value: string | null) => void;
}

export function useCompareState(clientId: string): UseCompareStateResult {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const plans = useMemo(() => readPlans(params), [params]);
  const togglesStr = params.get("toggles") ?? "";
  const toggleSet = useMemo(
    () => new Set(togglesStr.split(",").filter(Boolean)),
    [togglesStr],
  );

  // `useSearchParams()` returns a new instance every render, so we stash it
  // (plus the derived plans / toggleSet) in refs — updated in effects to
  // satisfy `react-hooks/refs` — and read through them so mutators keep
  // stable identity across re-renders.
  const paramsRef = useRef(params);
  const plansRef = useRef(plans);
  const toggleSetRef = useRef(toggleSet);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);
  useEffect(() => {
    plansRef.current = plans;
  }, [plans]);
  useEffect(() => {
    toggleSetRef.current = toggleSet;
  }, [toggleSet]);

  const writePlans = useCallback(
    (next: string[]) => {
      const np = new URLSearchParams(paramsRef.current);
      // Always normalize empty / nullish entries to the literal "base" token.
      const normalized = next.map((p) => (p && p !== "" ? p : "base"));
      np.delete("left");
      np.delete("right");
      np.set("plans", normalized.join(","));
      const qs = np.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          `compare:${clientId}:plans`,
          normalized.join(","),
        );
      }
    },
    [pathname, router, clientId],
  );

  const setPlanAt = useCallback(
    (i: number, ref: string | null) => {
      const current = plansRef.current;
      if (i < 0 || i >= current.length) return;
      const next = [...current];
      next[i] = ref ?? "base";
      writePlans(next);
    },
    [writePlans],
  );

  const addPlan = useCallback(() => {
    const current = plansRef.current;
    if (current.length >= MAX_PLANS) return;
    writePlans([...current, "base"]);
  }, [writePlans]);

  const removePlanAt = useCallback(
    (i: number) => {
      const current = plansRef.current;
      if (current.length <= MIN_PLANS) return;
      if (i < 0 || i >= current.length) return;
      const next = current.filter((_, idx) => idx !== i);
      writePlans(next);
    },
    [writePlans],
  );

  const makeBaseline = useCallback(
    (i: number) => {
      const current = plansRef.current;
      if (i <= 0 || i >= current.length) return;
      const next = [
        current[i],
        ...current.slice(0, i),
        ...current.slice(i + 1),
      ];
      writePlans(next);
    },
    [writePlans],
  );

  const setToggle = useCallback(
    (groupId: string, on: boolean) => {
      const np = new URLSearchParams(paramsRef.current);
      const next = new Set(toggleSetRef.current);
      if (on) next.add(groupId);
      else next.delete(groupId);
      if (next.size === 0) np.delete("toggles");
      else np.set("toggles", [...next].join(","));
      const qs = np.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router],
  );

  // ----- Legacy shims (kept until non-comparison-tab call sites migrate) -----
  const setSide = useCallback(
    (side: "left" | "right", value: string | null) => {
      const idx = side === "left" ? 0 : 1;
      const current = plansRef.current;
      const next = [...current];
      // Defensive: legacy callers may invoke setSide before the array has 2
      // entries (shouldn't happen via readPlans, but keep it safe).
      while (next.length <= idx) next.push("base");
      next[idx] = value && value !== "" ? value : "base";
      writePlans(next);
    },
    [writePlans],
  );

  return {
    plans,
    baselineIndex: 0,
    setPlanAt,
    addPlan,
    removePlanAt,
    makeBaseline,
    toggleSet,
    setToggle,
    left: plans[0] ?? "base",
    right: plans[1] ?? "base",
    setSide,
  };
}

function readPlans(params: URLSearchParams): string[] {
  const raw = params.get("plans");
  if (raw) {
    const toks = raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const clamped = toks.slice(0, MAX_PLANS);
    while (clamped.length < MIN_PLANS) clamped.push("base");
    return clamped;
  }
  // Legacy fallback: read ?left= / ?right= when ?plans is absent.
  const left = params.get("left");
  const right = params.get("right");
  if (left !== null || right !== null) {
    return [left ?? "base", right ?? "base"];
  }
  return ["base", "base"];
}
