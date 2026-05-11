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

interface Props {
  clientId: string;
  plans: ComparisonPlan[];
  initialLayout: ComparisonLayout;
  scenarios: ScenarioOption[];
  snapshots: SnapshotOption[];
  drawerPlans: ComparisonChangesDrawerPlan[];
}

export function ComparisonPageClient({
  clientId,
  plans,
  initialLayout,
  scenarios,
  snapshots,
  drawerPlans,
}: Props) {
  const [customizing, setCustomizing] = useState(false);
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <ComparisonPickerBar
        clientId={clientId}
        scenarios={scenarios}
        snapshots={snapshots}
        drawerPlans={drawerPlans}
        customizing={customizing}
        onToggleCustomize={() => setCustomizing((v) => !v)}
      />
      <ComparisonShell
        clientId={clientId}
        plans={plans}
        initialLayout={initialLayout}
        customizing={customizing}
        onExitCustomize={() => setCustomizing(false)}
      />
    </div>
  );
}
