"use client";

import { useState } from "react";
import {
  ScenarioPickerDropdown,
  type ScenarioOption,
  type SnapshotOption,
} from "@/components/scenario/scenario-picker-dropdown";

interface PresentationsLauncherProps {
  clientId: string;
  scenarios: ScenarioOption[];
  snapshots: SnapshotOption[];
}

export function PresentationsLauncher({
  clientId,
  scenarios,
  snapshots,
}: PresentationsLauncherProps) {
  // Picker value space: "base" | <scenarioId> | `snap:<snapshotId>`.
  // The export-pdf API takes scenarioId: string | null — "base" maps to null.
  const [pickerValue, setPickerValue] = useState<string>("base");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setError(null);
    setGenerating(true);
    try {
      const scenarioId = pickerValue === "base" ? null : pickerValue;
      const res = await fetch(
        `/api/clients/${clientId}/presentations/export-pdf`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scenarioId,
            pages: ["cashFlow"],
          }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = res.headers.get("content-disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(cd);
      a.download = match?.[1] ?? "presentation.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-semibold mb-2">Presentations</h1>
      <p className="text-sm text-gray-600 mb-6">
        Generate a multi-page client presentation. For now, the only available
        page is Cash Flow.
      </p>

      <div className="border rounded p-4 space-y-4 bg-white">
        <div>
          <label className="block text-sm font-medium mb-1">Scenario</label>
          <ScenarioPickerDropdown
            value={pickerValue}
            onChange={setPickerValue}
            scenarios={scenarios}
            snapshots={snapshots}
            ariaLabel="Scenario for presentation"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Pages</label>
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked readOnly />
              <span>Cash Flow</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-400">
              <input type="checkbox" disabled />
              <span>Balance Sheet (coming soon)</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-400">
              <input type="checkbox" disabled />
              <span>Income (coming soon)</span>
            </label>
          </div>
        </div>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="rounded bg-amber-700 px-4 py-2 text-white text-sm hover:bg-amber-800 disabled:opacity-50"
        >
          {generating ? "Generating…" : "Generate PDF"}
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
