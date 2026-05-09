"use client";

import { ScenarioPickerDropdown } from "@/components/scenario/scenario-picker-dropdown";
import type { ScenarioOption, SnapshotOption } from "@/components/scenario/scenario-picker-dropdown";
import { useCompareState } from "@/hooks/use-compare-state";

interface Props {
  clientId: string;
  scenarios: ScenarioOption[];
  snapshots: SnapshotOption[];
}

export function ComparisonPickerBar({ clientId, scenarios, snapshots }: Props) {
  const { left, right, setSide } = useCompareState(clientId);
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-6 py-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-slate-400">Plan 1</span>
        <ScenarioPickerDropdown
          value={left}
          onChange={(v) => setSide("left", v)}
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
          onChange={(v) => setSide("right", v)}
          scenarios={scenarios}
          snapshots={snapshots}
          ariaLabel="Plan 2"
        />
      </div>
    </div>
  );
}
