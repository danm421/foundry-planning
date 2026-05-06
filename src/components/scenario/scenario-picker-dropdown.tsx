"use client";

// Compare-panel scenario picker. A native `<select>` with optgroups so a11y
// + keyboard navigation come free. Snapshot ids are prefixed with `snap:` so
// the URL parser (`parseCompareSearchParams`) can disambiguate scenario vs
// snapshot from a single param.
//
// Note: the local interfaces below are deliberately decoupled from the
// drizzle row types so this component (and its tests) don't pull in the DB.

export interface ScenarioOption {
  id: string;
  name: string;
  isBaseCase: boolean;
}

export interface SnapshotOption {
  id: string;
  name: string;
  sourceKind: "manual" | "pdf_export";
}

export function ScenarioPickerDropdown({
  value,
  onChange,
  scenarios,
  snapshots,
  ariaLabel,
  includeDoNothing = false,
}: {
  value: string;
  onChange: (next: string) => void;
  scenarios: ScenarioOption[];
  snapshots: SnapshotOption[];
  ariaLabel?: string;
  includeDoNothing?: boolean;
}) {
  const liveScenarios = scenarios.filter((s) => !s.isBaseCase);
  const manualSnaps = snapshots.filter((s) => s.sourceKind === "manual");
  const pdfSnaps = snapshots.filter((s) => s.sourceKind === "pdf_export");
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel ?? "Scenario"}
      className="w-full bg-[#0b0c0f] border border-[#1f2024] rounded h-9 px-2 text-[13px] text-[#e7e6e2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4a04a]"
    >
      <option value="base">Base case</option>
      {liveScenarios.length > 0 && (
        <optgroup label="Scenarios">
          {liveScenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </optgroup>
      )}
      {manualSnaps.length > 0 && (
        <optgroup label="Snapshots — Manual">
          {manualSnaps.map((s) => (
            <option key={s.id} value={`snap:${s.id}`}>
              {s.name}
            </option>
          ))}
        </optgroup>
      )}
      {pdfSnaps.length > 0 && (
        <optgroup label="Snapshots — PDF exports">
          {pdfSnaps.map((s) => (
            <option key={s.id} value={`snap:${s.id}`}>
              {s.name}
            </option>
          ))}
        </optgroup>
      )}
      {includeDoNothing && (
        <optgroup label="Counterfactual">
          <option value="do-nothing">Do nothing (no plan)</option>
        </optgroup>
      )}
    </select>
  );
}
