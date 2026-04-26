"use client";

import { useCompareState } from "@/hooks/use-compare-state";
import {
  ScenarioPickerDropdown,
  type ScenarioOption,
  type SnapshotOption,
} from "./scenario-picker-dropdown";

export interface CompareScenarioBarProps {
  clientId: string;
  scenarios: ScenarioOption[];
  snapshots: SnapshotOption[];
}

export function CompareScenarioBar({
  clientId,
  scenarios,
  snapshots,
}: CompareScenarioBarProps) {
  const { left, right, setSide } = useCompareState(clientId);

  return (
    <div
      data-testid="compare-scenario-bar"
      className="flex items-center gap-3 px-6 h-12 border-b border-[#1f2024] bg-[#0b0c0f]"
    >
      <div className="text-[11px] tracking-[0.18em] uppercase font-mono text-[#7a5b29] shrink-0">
        COMPARING
      </div>
      <div className="w-56">
        <ScenarioPickerDropdown
          value={left}
          onChange={(v) => setSide("left", v)}
          scenarios={scenarios}
          snapshots={snapshots}
          ariaLabel="Left scenario"
        />
      </div>
      <div className="italic text-[11px] text-[#6b6760] shrink-0">vs</div>
      <div className="w-56">
        <ScenarioPickerDropdown
          value={right}
          onChange={(v) => setSide("right", v)}
          scenarios={scenarios}
          snapshots={snapshots}
          ariaLabel="Right scenario"
        />
      </div>
    </div>
  );
}
