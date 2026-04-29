"use client";

// src/components/scenario/compare-panel.tsx
//
// Root compare panel hosted on the scenario page. Wires the URL-backed
// `useCompareState` hook to two `<ScenarioPickerDropdown>` selects (left vs
// right), a `<NetDeltaSummary>` header, and the per-toggle `<ToggleList>`.
//
// Two layout modes:
//   - expanded: 360px column with header, COMPARING section, summary + toggles
//   - collapsed: 48px-wide rail with vertical truncated label + expand chevron
//
// Collapsed/expanded state is intentionally local (component state) — it's a
// view preference, not something that needs to round-trip through the URL.

import { useState } from "react";
import { useCompareState } from "@/hooks/use-compare-state";
import type {
  ScenarioOption,
  SnapshotOption,
} from "./scenario-picker-dropdown";
import { NetDeltaSummary } from "./net-delta-summary";
import { SnapshotButton } from "./snapshot-button";
import { ToggleList, type DeltaPill } from "./toggle-list";
import type { ToggleGroup } from "@/engine/scenario/types";

export interface ComparePanelProps {
  clientId: string;
  scenarios: ScenarioOption[];
  snapshots: SnapshotOption[];
  rightToggleGroups: ToggleGroup[];
  netDelta: { value: number; metricLabel: string; sparkline: number[] } | null;
  // Optional. Server-component pages can't pass a function across the RSC
  // boundary, so the delta-preview pill is opt-in: pages that have a server
  // action wired up pass it; pages still on the deferred stub omit it (rows
  // render without pills instead of crashing on serialization).
  deltaFetcher?: (toggleId: string) => Promise<DeltaPill>;
}

export function ComparePanel({
  clientId,
  scenarios,
  snapshots,
  rightToggleGroups,
  netDelta,
  deltaFetcher,
}: ComparePanelProps) {
  const { left, right } = useCompareState(clientId);
  const [collapsed, setCollapsed] = useState(false);

  const leftLabel = labelForSide(left, scenarios, snapshots);
  const rightLabel = labelForSide(right, scenarios, snapshots);

  // When right is a frozen snapshot, the toggle rows show what was on/off at
  // freeze time but cannot be flipped — the effective tree is captured. The
  // snapshot button is also gated since "snapshot a snapshot" is meaningless.
  const isRightSnapshot = right.startsWith("snap:");

  if (collapsed) {
    return (
      <aside
        aria-label="Compare panel (collapsed)"
        data-testid="compare-panel-collapsed"
        className="w-12 shrink-0 border-l border-[#1f2024] bg-[#101114] flex flex-col items-center py-4"
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Expand compare panel"
          className="text-[#6b6760] hover:text-[#e7e6e2] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d4a04a] rounded"
        >
          ‹
        </button>
        <div
          data-testid="compare-panel-vertical-label"
          className="mt-4 [writing-mode:vertical-rl] rotate-180 text-[11px] tracking-[0.18em] uppercase font-mono text-[#7a5b29]"
        >
          {leftLabel} · vs · {rightLabel}
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Compare panel"
      data-testid="compare-panel"
      className="w-[360px] shrink-0 border-l border-[#1f2024] bg-[#101114] flex flex-col"
    >
      <div className="px-4 py-3 border-b border-[#1f2024] flex items-center justify-between">
        <div className="text-[11px] tracking-[0.18em] uppercase font-mono text-[#7a5b29]">
          §.07 · COMPARE
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse compare panel"
          className="text-[#6b6760] hover:text-[#e7e6e2] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d4a04a] rounded"
        >
          ›
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {left !== right && netDelta && (
          <NetDeltaSummary
            delta={netDelta.value}
            metricLabel={netDelta.metricLabel}
            sparklineData={netDelta.sparkline}
          />
        )}
        {left !== right && rightToggleGroups.length > 0 && (
          <ToggleList
            clientId={clientId}
            groups={rightToggleGroups}
            deltaFetcher={deltaFetcher}
            interactive={!isRightSnapshot}
          />
        )}
      </div>
      <SnapshotButton clientId={clientId} disabled={isRightSnapshot} />
    </aside>
  );
}

function labelForSide(
  value: string,
  scenarios: ScenarioOption[],
  snapshots: SnapshotOption[],
): string {
  if (value === "base") return "BASE";
  if (value.startsWith("snap:")) {
    const snap = snapshots.find((s) => s.id === value.slice("snap:".length));
    return snap ? truncate(snap.name, 14).toUpperCase() : "SNAP";
  }
  const scn = scenarios.find((s) => s.id === value);
  return scn ? truncate(scn.name, 14).toUpperCase() : "SCN";
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
