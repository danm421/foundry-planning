"use client";

import { useState } from "react";
import type { ComparisonLayoutV5 } from "@/lib/comparison/layout-schema";
import { ComparisonShell } from "./comparison-shell";
import { useStripPlansUrl } from "./strip-plans-url";
import {
  NewComparisonModal,
  type PresetSummary,
  type TemplateSummary,
} from "./new-comparison-modal";
import { SlotMappingModal } from "./slot-mapping-modal";

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
  const [newOpen, setNewOpen] = useState(false);
  const [pendingPreset, setPendingPreset] = useState<PresetSummary | null>(null);
  const [pendingTemplate, setPendingTemplate] = useState<TemplateSummary | null>(null);

  const handleSelectComparison = async (cid: string) => {
    if (cid === activeCid) return;
    const res = await fetch(`/api/clients/${clientId}/comparisons/${cid}`);
    if (!res.ok) return;
    const { comparison } = await res.json();
    setActiveCid(cid);
    setLayout(comparison.layout);
  };

  const handlePickBlank = async () => {
    setNewOpen(false);
    const name = window.prompt("Name your comparison", "Untitled");
    if (!name || !name.trim()) return;
    const res = await fetch(`/api/clients/${clientId}/comparisons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "blank", name: name.trim() }),
    });
    if (!res.ok) return;
    const { comparison } = await res.json();
    setComparisons((cs) => [...cs, { id: comparison.id, name: comparison.name }]);
    setActiveCid(comparison.id);
    setLayout(comparison.layout);
  };

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
        onOpenNewComparison={() => setNewOpen(true)}
        onRenameActive={noop}
        onDeleteActive={noop}
        onSaveActiveAsTemplate={noop}
      />
      <NewComparisonModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onPickBlank={handlePickBlank}
        onPickPreset={(p) => { setPendingPreset(p); setNewOpen(false); }}
        onPickTemplate={(t) => { setPendingTemplate(t); setNewOpen(false); }}
      />
      {pendingPreset && (
        <SlotMappingModal
          open
          templateName={pendingPreset.name}
          slotLabels={pendingPreset.slotLabels}
          clientPlans={scenarios}
          defaultName={pendingPreset.name}
          onCancel={() => setPendingPreset(null)}
          onConfirm={async ({ name, slotMappings }) => {
            const res = await fetch(`/api/clients/${clientId}/comparisons`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                source: "preset",
                presetKey: pendingPreset.key,
                name,
                slotMappings,
              }),
            });
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              throw new Error(body.error ?? "Failed to create comparison");
            }
            const { comparison } = await res.json();
            setComparisons((cs) => [...cs, { id: comparison.id, name: comparison.name }]);
            setActiveCid(comparison.id);
            setLayout(comparison.layout);
            setPendingPreset(null);
          }}
        />
      )}
      {pendingTemplate && (
        <SlotMappingModal
          open
          templateName={pendingTemplate.name}
          slotLabels={pendingTemplate.slotLabels}
          clientPlans={scenarios}
          defaultName={pendingTemplate.name}
          onCancel={() => setPendingTemplate(null)}
          onConfirm={async ({ name, slotMappings }) => {
            const res = await fetch(`/api/clients/${clientId}/comparisons`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                source: "template",
                templateId: pendingTemplate.id,
                name,
                slotMappings,
              }),
            });
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              throw new Error(body.error ?? "Failed to create comparison");
            }
            const { comparison } = await res.json();
            setComparisons((cs) => [...cs, { id: comparison.id, name: comparison.name }]);
            setActiveCid(comparison.id);
            setLayout(comparison.layout);
            setPendingTemplate(null);
          }}
        />
      )}
    </div>
  );
}
