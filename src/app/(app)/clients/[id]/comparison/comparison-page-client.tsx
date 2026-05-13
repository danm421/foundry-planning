"use client";

import { useState } from "react";
import type { ComparisonLayoutV5 } from "@/lib/comparison/layout-schema";
import { ComparisonShell } from "./comparison-shell";
import { useStripPlansUrl } from "./strip-plans-url";

interface ComparisonSummary {
  id: string;
  name: string;
}

interface Props {
  clientId: string;
  initialLayout: ComparisonLayoutV5;
  scenarios: { id: string; name: string }[];
  primaryScenarioId: string;
  clientRetirementYear: number | null;
  comparisons: ComparisonSummary[];
  activeCid: string | null;
}

export function ComparisonPageClient({
  clientId,
  initialLayout,
  scenarios,
  primaryScenarioId,
  clientRetirementYear,
  comparisons: initialComparisons,
  activeCid: initialActiveCid,
}: Props) {
  useStripPlansUrl();

  const [comparisons, setComparisons] = useState<ComparisonSummary[]>(initialComparisons);
  const [activeCid, setActiveCid] = useState<string | null>(initialActiveCid);
  const [layout, setLayout] = useState<ComparisonLayoutV5>(initialLayout);

  const handleSelectComparison = async (cid: string) => {
    if (cid === activeCid) return;
    const res = await fetch(`/api/clients/${clientId}/comparisons/${cid}`);
    if (!res.ok) return;
    const { comparison } = await res.json();
    setActiveCid(cid);
    setLayout(comparison.layout);
  };

  // The picker/slot-mapping/rename/delete/save-as flows are wired in
  // subsequent tasks. For Task 17 the buttons exist but the handlers
  // are no-ops so the header renders cleanly.
  const noop = () => {};

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <ComparisonShell
        key={activeCid ?? "empty"}
        clientId={clientId}
        activeCid={activeCid}
        comparisons={comparisons}
        initialLayout={layout}
        scenarios={scenarios}
        primaryScenarioId={primaryScenarioId}
        clientRetirementYear={clientRetirementYear}
        onSelectComparison={handleSelectComparison}
        onComparisonsChange={setComparisons}
        onOpenNewComparison={noop}
        onRenameActive={noop}
        onDeleteActive={noop}
        onSaveActiveAsTemplate={noop}
      />
    </div>
  );
}
