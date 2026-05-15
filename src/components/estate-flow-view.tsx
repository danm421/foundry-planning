"use client";

import { useMemo, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { runProjectionWithEvents } from "@/engine/projection";
import { diffWorkingCopy } from "@/lib/estate/estate-flow-diff";
import { buildOwnershipColumn } from "@/lib/estate/estate-flow-ownership";
import {
  ScenarioPickerDropdown,
  type ScenarioOption,
  type SnapshotOption,
} from "@/components/scenario/scenario-picker-dropdown";
import type { ClientData } from "@/engine/types";

export interface EstateFlowViewProps {
  clientId: string;
  scenarioId: string;
  isMarried: boolean;
  ownerNames: { clientName: string; spouseName: string | null };
  initialClientData: ClientData;
  scenarios?: ScenarioOption[];
  snapshots?: SnapshotOption[];
}

// ── DeathOrderToggle ─────────────────────────────────────────────────────────

interface DeathOrderToggleProps {
  value: "primaryFirst" | "spouseFirst";
  onChange: (next: "primaryFirst" | "spouseFirst") => void;
  ownerNames: { clientName: string; spouseName: string | null };
}

function DeathOrderToggle({ value, onChange, ownerNames }: DeathOrderToggleProps) {
  const primaryLabel = ownerNames.clientName;
  const spouseLabel = ownerNames.spouseName ?? "Spouse";

  return (
    <div className="flex items-center gap-1 rounded border border-[#1f2024] p-0.5">
      <button
        type="button"
        onClick={() => onChange("primaryFirst")}
        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
          value === "primaryFirst"
            ? "bg-[#d4a04a] text-[#0b0c0f]"
            : "text-[#7a7975] hover:text-[#e7e6e2]"
        }`}
      >
        {primaryLabel} dies first
      </button>
      <button
        type="button"
        onClick={() => onChange("spouseFirst")}
        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
          value === "spouseFirst"
            ? "bg-[#d4a04a] text-[#0b0c0f]"
            : "text-[#7a7975] hover:text-[#e7e6e2]"
        }`}
      >
        {spouseLabel} dies first
      </button>
    </div>
  );
}

// ── EstateFlowView ───────────────────────────────────────────────────────────

export default function EstateFlowView(props: EstateFlowViewProps) {
  const original = props.initialClientData;
  const [working, setWorking] = useState<ClientData>(original);
  const [ordering, setOrdering] =
    useState<"primaryFirst" | "spouseFirst">("primaryFirst");

  const router = useRouter();
  const pathname = usePathname();

  const projection = useMemo(
    () => runProjectionWithEvents(working),
    [working],
  );
  const ownership = useMemo(() => buildOwnershipColumn(working), [working]);
  const pendingChanges = useMemo(
    () => diffWorkingCopy(original, working),
    [original, working],
  );
  const isDirty = pendingChanges.length > 0;

  // One mutation entry point: every dialog calls this with an edit fn.
  const applyEdit = useCallback(
    (fn: (d: ClientData) => ClientData) => setWorking((cur) => fn(cur)),
    [],
  );

  // Silence unused-variable lint until Tasks 6–9 wire these up.
  void applyEdit;

  function handleScenarioChange(next: string) {
    // TODO: Task 9 unsaved-changes guard
    router.push(`${pathname}?scenario=${encodeURIComponent(next)}`);
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Control bar */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">Estate Flow</h1>
        <div className="flex items-center gap-3">
          {props.isMarried && (
            <DeathOrderToggle
              value={ordering}
              onChange={setOrdering}
              ownerNames={props.ownerNames}
            />
          )}
          {props.scenarios && props.snapshots && (
            <div className="w-48">
              {/* ScenarioPickerDropdown wired to ?scenario= */}
              <ScenarioPickerDropdown
                value={props.scenarioId}
                onChange={handleScenarioChange}
                scenarios={props.scenarios}
                snapshots={props.snapshots}
                ariaLabel="Scenario"
              />
            </div>
          )}
          {isDirty && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
              Modified — unsaved
            </span>
          )}
        </div>
      </div>

      {/* Three-column layout */}
      <div className="grid grid-cols-3 gap-4">
        {/* Ownership column — Task 6 */}
        <div className="rounded border p-3 text-sm text-muted-foreground">
          Ownership column — Task 6
          {/* grandTotal wired to avoid unused-variable lint */}
          <span className="sr-only">{ownership.grandTotal}</span>
        </div>
        {/* Death column 1 — Task 7 */}
        <div className="rounded border p-3 text-sm text-muted-foreground">
          1st death column — Task 7
          {/* projection wired to avoid unused-variable lint */}
          <span className="sr-only">{projection.years.length} years</span>
        </div>
        {/* Death column 2 — Task 7, married only */}
        {props.isMarried && (
          <div className="rounded border p-3 text-sm text-muted-foreground">
            2nd death column — Task 7
            {/* pendingChanges wired to avoid unused-variable lint */}
            <span className="sr-only">{pendingChanges.length} changes</span>
          </div>
        )}
        {!props.isMarried && (
          <div className="rounded border p-3 text-sm text-muted-foreground">
            {/* placeholder to keep grid balanced for single clients */}
          </div>
        )}
      </div>

      {/* Save bar — Task 10 */}
    </div>
  );
}
