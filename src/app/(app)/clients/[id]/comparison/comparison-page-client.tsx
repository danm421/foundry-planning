"use client";

import { useState } from "react";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { ComparisonLayout } from "@/lib/comparison/layout-schema";
import type {
  ScenarioOption,
  SnapshotOption,
} from "@/components/scenario/scenario-picker-dropdown";
import type { ComparisonChangesDrawerPlan } from "./comparison-changes-drawer";
import { ComparisonPickerBar } from "./comparison-picker-bar";
import { ComparisonShell } from "./comparison-shell";
import { YearRangeBar } from "./year-range-bar";
import { useYearRange } from "./use-year-range";

interface Props {
  clientId: string;
  plans: ComparisonPlan[];
  initialLayout: ComparisonLayout;
  scenarios: ScenarioOption[];
  snapshots: SnapshotOption[];
  drawerPlans: ComparisonChangesDrawerPlan[];
}

function parseBirthYear(dateOfBirth: string | undefined): number | undefined {
  if (!dateOfBirth) return undefined;
  const yr = parseInt(dateOfBirth.slice(0, 4), 10);
  return Number.isFinite(yr) ? yr : undefined;
}

export function ComparisonPageClient({
  clientId,
  plans,
  initialLayout,
  scenarios,
  snapshots,
  drawerPlans,
}: Props) {
  const [panelOpen, setPanelOpen] = useState(false);

  const yr = useYearRange({
    plans,
    initialYearRange: initialLayout.yearRange,
  });

  const clientBirthYear = parseBirthYear(plans[0]?.tree.client?.dateOfBirth);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <ComparisonPickerBar
        clientId={clientId}
        scenarios={scenarios}
        snapshots={snapshots}
        drawerPlans={drawerPlans}
        customizing={panelOpen}
        onToggleCustomize={() => setPanelOpen((v) => !v)}
      />
      <YearRangeBar
        yearRange={yr.yearRange}
        min={yr.min}
        max={yr.max}
        clientBirthYear={clientBirthYear}
        onChange={yr.setYearRange}
        onReset={yr.reset}
      />
      <ComparisonShell
        clientId={clientId}
        plans={plans}
        initialLayout={initialLayout}
        panelOpen={panelOpen}
        onClosePanel={() => setPanelOpen(false)}
        yearRange={yr.yearRange}
      />
    </div>
  );
}
