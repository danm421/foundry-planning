"use client";

import { useState } from "react";
import { ScenarioPickerDropdown } from "@/components/scenario/scenario-picker-dropdown";
import type { ScenarioOption, SnapshotOption } from "@/components/scenario/scenario-picker-dropdown";
import { useCompareState } from "@/hooks/use-compare-state";
import {
  ComparisonChangesDrawer,
  type ComparisonChangesDrawerPlan,
} from "./comparison-changes-drawer";

interface Props {
  clientId: string;
  scenarios: ScenarioOption[];
  snapshots: SnapshotOption[];
  /** Per-plan panel data for the slide-out Changes drawer. Empty when neither
   *  side resolves to a live scenario (base/snapshot have nothing editable). */
  drawerPlans?: ComparisonChangesDrawerPlan[];
}

export function ComparisonPickerBar({
  clientId,
  scenarios,
  snapshots,
  drawerPlans = [],
}: Props) {
  const { plans, setPlanAt } = useCompareState(clientId);
  const left = plans[0] ?? "base";
  const right = plans[1] ?? "base";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(0);

  const totalChanges = drawerPlans.reduce((n, p) => n + p.changes.length, 0);

  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-6 py-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-slate-400">Plan 1</span>
        <ScenarioPickerDropdown
          value={left}
          onChange={(v) => setPlanAt(0, v)}
          scenarios={scenarios}
          snapshots={snapshots}
          ariaLabel="Plan 1"
        />
      </div>
      <span className="text-slate-500">vs</span>
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-slate-400">Plan 2</span>
        <ScenarioPickerDropdown
          value={right}
          onChange={(v) => setPlanAt(1, v)}
          scenarios={scenarios}
          snapshots={snapshots}
          ariaLabel="Plan 2"
        />
      </div>
      {drawerPlans.length > 0 && (
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open scenario changes drawer"
          className="ml-auto flex items-center gap-2 rounded-full border border-slate-700 px-3 h-8 text-xs text-slate-200 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4a04a]"
        >
          <span>Changes</span>
          <span className="font-mono text-[#d4a04a]">{totalChanges}</span>
        </button>
      )}
      <ComparisonChangesDrawer
        clientId={clientId}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        plans={drawerPlans}
      />
    </div>
  );
}
