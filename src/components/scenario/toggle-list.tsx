"use client";

// src/components/scenario/toggle-list.tsx
//
// Renders a list of toggle-group rows for the Compare panel. Each row's
// delta-preview pill is fetched lazily — when the row enters the viewport
// (via IntersectionObserver) we call the parent-supplied `deltaFetcher`. In
// SSR / test environments without IntersectionObserver, we fetch on mount.
//
// The toggle on/off state is sourced from the URL through `useCompareState`,
// so multiple ToggleList instances stay in sync without local state.

import { useCallback, useEffect, useRef, useState } from "react";
import { useCompareState } from "@/hooks/use-compare-state";
import type { ToggleGroup } from "@/engine/scenario/types";

export interface DeltaPill {
  delta: number;
  metricLabel: string;
}

export interface ToggleListProps {
  clientId: string;
  groups: ToggleGroup[];
  /**
   * Fetches the delta-preview pill for a given group id. Optional: when
   * omitted, rows render without pills (the deferred-stub state, used while
   * real per-toggle delta wiring is still pending — see future-work/reports.md).
   */
  deltaFetcher?: (toggleId: string) => Promise<DeltaPill>;
  /**
   * When false, renders the rows in a read-only mode: switches are disabled,
   * clicks are no-ops, and the rows are visually muted. Used when the right
   * side is a frozen snapshot — toggling there has no meaning since the
   * effective tree was captured at freeze time. Defaults to `true`.
   */
  interactive?: boolean;
}

export function ToggleList({
  clientId,
  groups,
  deltaFetcher,
  interactive = true,
}: ToggleListProps) {
  const { toggleSet, setToggle } = useCompareState(clientId);
  if (groups.length === 0) return null;
  return (
    <div data-testid="toggle-list">
      <div className="px-4 py-2 text-[11px] tracking-[0.18em] uppercase font-mono text-[#7a5b29]">
        TOGGLES
      </div>
      {groups.map((g) => (
        <ToggleRow
          key={g.id}
          group={g}
          on={toggleSet.has(g.id)}
          parentOff={!!g.requiresGroupId && !toggleSet.has(g.requiresGroupId)}
          onToggle={(on) => setToggle(g.id, on)}
          deltaFetcher={deltaFetcher}
          interactive={interactive}
        />
      ))}
    </div>
  );
}

function ToggleRow({
  group,
  on,
  parentOff,
  onToggle,
  deltaFetcher,
  interactive,
}: {
  group: ToggleGroup;
  on: boolean;
  parentOff: boolean;
  onToggle: (on: boolean) => void;
  deltaFetcher?: (toggleId: string) => Promise<DeltaPill>;
  interactive: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<DeltaPill | null>(null);
  const [error, setError] = useState(false);

  // Stable callback so the effect's dep list doesn't churn on parent re-renders.
  const fetchAndSet = useCallback(() => {
    if (!deltaFetcher) return;
    deltaFetcher(group.id)
      .then(setPill)
      .catch(() => setError(true));
  }, [deltaFetcher, group.id]);

  useEffect(() => {
    if (!deltaFetcher) return;
    const el = ref.current;
    if (!el || pill || error) return;
    if (
      typeof window === "undefined" ||
      typeof IntersectionObserver === "undefined"
    ) {
      fetchAndSet();
      return;
    }
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        fetchAndSet();
        obs.disconnect();
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [deltaFetcher, pill, error, fetchAndSet]);

  return (
    <div
      ref={ref}
      data-testid={`toggle-row-${group.id}`}
      className={`px-4 py-3 border-b border-[#1f2024] flex items-center gap-3 ${
        parentOff ? "opacity-40" : !interactive ? "opacity-60" : ""
      }`}
    >
      <ToggleSwitch
        on={on}
        onChange={onToggle}
        disabled={parentOff || !interactive}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[14px] text-[#e7e6e2] truncate">{group.name}</div>
        {pill && !error && (
          <div
            data-testid={`toggle-row-pill-${group.id}`}
            className={`text-[11px] mt-1 font-mono tabular-nums ${
              pill.delta >= 0 ? "text-[#7fa97f]" : "text-[#c87a7a]"
            }`}
          >
            {pill.delta >= 0 ? "+" : "−"}${shortNum(Math.abs(pill.delta))}{" "}
            {pill.metricLabel}
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleSwitch({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!disabled) onChange(!on);
      }}
      disabled={disabled}
      aria-pressed={on}
      aria-label={on ? "Toggle off" : "Toggle on"}
      className={`w-8 h-4 rounded-full border transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d4a04a] disabled:cursor-not-allowed ${
        on ? "bg-[#d4a04a] border-[#d4a04a]" : "bg-transparent border-[#1f2024]"
      }`}
    >
      <span
        className={`block w-3 h-3 rounded-full transition ${
          on ? "bg-[#0b0c0f] ml-4" : "bg-[#6b6760] ml-0"
        }`}
        aria-hidden="true"
      />
    </button>
  );
}

function shortNum(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "k";
  return n.toFixed(0);
}
