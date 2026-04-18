"use client";

import type { OwnershipView } from "./ownership-filter";

interface HeaderControlsProps {
  years: number[];
  selectedYear: number;
  onYearChange: (year: number) => void;
  view: OwnershipView;
  onViewChange: (view: OwnershipView) => void;
  /** Married clients with a spouse name. Hides the View selector entirely when false. */
  showViewSelector: boolean;
  /** Whether the "Entities only" option should appear in the View dropdown. */
  hasEntityAccounts: boolean;
  onExportPdf: () => void;
  exportInProgress: boolean;
}

const VIEW_LABELS: Record<OwnershipView, string> = {
  consolidated: "Consolidated",
  client: "Client only",
  spouse: "Spouse only",
  joint: "Joint only",
  entities: "Entities only",
};

export default function HeaderControls({
  years,
  selectedYear,
  onYearChange,
  view,
  onViewChange,
  showViewSelector,
  hasEntityAccounts,
  onExportPdf,
  exportInProgress,
}: HeaderControlsProps) {
  const viewOptions: OwnershipView[] = hasEntityAccounts
    ? ["consolidated", "client", "spouse", "joint", "entities"]
    : ["consolidated", "client", "spouse", "joint"];

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold tracking-tight text-gray-100">Balance Sheet</h1>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-400">
          AS OF
          <select
            value={selectedYear}
            onChange={(e) => onYearChange(Number(e.target.value))}
            className="rounded border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>

        {showViewSelector && (
          <label className="flex items-center gap-2 text-sm text-gray-400">
            View
            <select
              value={view}
              onChange={(e) => onViewChange(e.target.value as OwnershipView)}
              className="rounded border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            >
              {viewOptions.map((v) => (
                <option key={v} value={v}>{VIEW_LABELS[v]}</option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          onClick={onExportPdf}
          disabled={exportInProgress}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exportInProgress ? "Exporting..." : "Export PDF"}
        </button>
      </div>
    </div>
  );
}
