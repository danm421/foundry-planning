"use client";

import { useMemo, useState } from "react";
import type { ComparisonLayoutV5 } from "@/lib/comparison/layout-schema";
import { extractSlots } from "@/lib/comparison/templates";
import { ComparisonShell } from "./comparison-shell";
import { useStripPlansUrl } from "./strip-plans-url";
import {
  NewComparisonModal,
  type PresetSummary,
  type TemplateSummary,
} from "./new-comparison-modal";
import { SlotMappingModal } from "./slot-mapping-modal";
import { SaveAsTemplateModal } from "./save-as-template-modal";
import { RenameComparisonModal } from "./rename-comparison-modal";

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
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const nameByPlanId = useMemo(
    () => Object.fromEntries(scenarios.map((s) => [s.id, s.name])),
    [scenarios],
  );

  const defaultSlotLabels = useMemo(() => {
    try {
      return extractSlots(layout, nameByPlanId).slotLabels;
    } catch {
      return [];
    }
  }, [layout, nameByPlanId]);

  const activeName = comparisons.find((c) => c.id === activeCid)?.name ?? "";

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

  const handleDelete = async () => {
    if (!activeCid) return;
    if (!window.confirm("Delete this comparison? This cannot be undone.")) return;
    const res = await fetch(`/api/clients/${clientId}/comparisons/${activeCid}`, {
      method: "DELETE",
    });
    if (!res.ok) return;
    const remaining = comparisons.filter((c) => c.id !== activeCid);
    setComparisons(remaining);
    if (remaining.length === 0) {
      setActiveCid(null);
      setNewOpen(true);
      return;
    }
    const next = remaining[0];
    setActiveCid(next.id);
    const r = await fetch(`/api/clients/${clientId}/comparisons/${next.id}`);
    if (r.ok) {
      const { comparison } = await r.json();
      setLayout(comparison.layout);
    }
  };

  const isEmpty = activeCid === null && comparisons.length === 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {isEmpty ? (
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="mx-auto w-full max-w-md rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
            <h2 className="text-xl font-semibold text-slate-100">No comparisons yet</h2>
            <p className="mt-2 text-sm text-slate-400">
              Pick a starting point to build this client&apos;s first comparison.
            </p>
            <button
              type="button"
              onClick={() => setNewOpen(true)}
              className="mt-6 rounded-md bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white"
            >
              + New comparison
            </button>
          </div>
        </div>
      ) : (
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
          onRenameActive={() => activeCid && setRenameOpen(true)}
          onDeleteActive={handleDelete}
          onSaveActiveAsTemplate={() => activeCid && setSaveAsOpen(true)}
        />
      )}
      <RenameComparisonModal
        open={renameOpen}
        initial={activeName}
        onCancel={() => setRenameOpen(false)}
        onConfirm={async (name) => {
          if (!activeCid) return;
          const res = await fetch(`/api/clients/${clientId}/comparisons/${activeCid}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error ?? "Rename failed");
          }
          setComparisons((cs) =>
            cs.map((c) => (c.id === activeCid ? { ...c, name } : c)),
          );
          setRenameOpen(false);
        }}
      />
      <SaveAsTemplateModal
        open={saveAsOpen}
        initialName={activeName}
        defaultSlotLabels={defaultSlotLabels}
        onCancel={() => setSaveAsOpen(false)}
        onConfirm={async ({ name, description, visibility, slotLabels }) => {
          if (!activeCid) return;
          const res = await fetch(
            `/api/clients/${clientId}/comparisons/${activeCid}/save-as-template`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name,
                description,
                visibility,
                nameByPlanId,
                slotLabels,
              }),
            },
          );
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error ?? "Failed to save template");
          }
          setSaveAsOpen(false);
        }}
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
