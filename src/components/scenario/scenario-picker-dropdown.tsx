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
  // Orphan integration-test scenarios (changes-writer.test.ts mints
  // `writer-test-<uuid>` rows and deletes them in afterEach; crashes leak them)
  // pile up in the picker. Hide them in the UI; leave DB rows alone.
  const liveScenarios = scenarios.filter(
    (s) => !s.isBaseCase && !s.name.startsWith("writer-test-"),
  );
  const manualSnaps = snapshots.filter((s) => s.sourceKind === "manual");
  const pdfSnaps = snapshots.filter((s) => s.sourceKind === "pdf_export");
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel ?? "Scenario"}
      className="w-full bg-paper border border-hair rounded h-9 px-2 text-[13px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
