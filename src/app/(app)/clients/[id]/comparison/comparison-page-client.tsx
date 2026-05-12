"use client";

import type { ComparisonLayoutV5 } from "@/lib/comparison/layout-schema";
import { ComparisonShell } from "./comparison-shell";
import { useStripPlansUrl } from "./strip-plans-url";

interface Props {
  clientId: string;
  initialLayout: ComparisonLayoutV5;
  scenarios: { id: string; name: string }[];
  primaryScenarioId: string;
  clientRetirementYear: number | null;
}

export function ComparisonPageClient({
  clientId,
  initialLayout,
  scenarios,
  primaryScenarioId,
  clientRetirementYear,
}: Props) {
  useStripPlansUrl();
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <ComparisonShell
        clientId={clientId}
        initialLayout={initialLayout}
        scenarios={scenarios}
        primaryScenarioId={primaryScenarioId}
        clientRetirementYear={clientRetirementYear}
      />
    </div>
  );
}
