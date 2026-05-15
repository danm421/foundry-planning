"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { runProjectionWithEvents } from "@/engine/projection";
import { diffWorkingCopy } from "@/lib/estate/estate-flow-diff";
import { buildOwnershipColumn } from "@/lib/estate/estate-flow-ownership";
import {
  ScenarioPickerDropdown,
  type ScenarioOption,
  type SnapshotOption,
} from "@/components/scenario/scenario-picker-dropdown";
import { EstateFlowOwnershipColumn } from "@/components/estate-flow-ownership-column";
import { EstateFlowDeathColumn } from "@/components/estate-flow-death-column";
import { buildEstateTransferReportData } from "@/lib/estate/transfer-report";
import EstateFlowChangeOwnerDialog from "@/components/estate-flow-change-owner-dialog";
import EstateFlowChangeDistributionDialog from "@/components/estate-flow-change-distribution-dialog";
import { changeOwner, changeBeneficiaries, changeWillBequests } from "@/lib/estate/estate-flow-edits";
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
    <div
      role="group"
      aria-label="Death order"
      className="flex items-center gap-1 rounded border border-[#1f2024] p-0.5"
    >
      <button
        type="button"
        aria-pressed={value === "primaryFirst"}
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
        aria-pressed={value === "spouseFirst"}
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
  const [ownerDialogId, setOwnerDialogId] = useState<string | null>(null);
  const [distributionDialogId, setDistributionDialogId] = useState<string | null>(null);

  const router = useRouter();
  const pathname = usePathname();

  // `ordering` is NOT passed to runProjectionWithEvents — the projection always
  // computes both first-death and second-death sections from the data.
  // `ordering` is a display-time selector consumed by the death-column
  // components (Tasks 6-7) to decide which death feeds which column: when
  // "primaryFirst", column 1 shows the client's death and column 2 shows the
  // spouse's death; "spouseFirst" swaps them. The projection result is
  // identical either way.
  const projection = useMemo(
    () => runProjectionWithEvents(working),
    [working],
  );
  const ownership = useMemo(() => buildOwnershipColumn(working), [working]);
  const reportData = useMemo(
    () =>
      buildEstateTransferReportData({
        projection,
        asOf: { kind: "split" },
        ordering,
        clientData: working,
        ownerNames: props.ownerNames,
      }),
    [projection, ordering, working, props.ownerNames],
  );
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

  // Warn on browser close / tab close / hard navigation when there are unsaved edits.
  useEffect(() => {
    if (!isDirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Legacy browsers require returnValue to be set.
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const handleScenarioChange = useCallback(
    (next: string) => {
      // Unsaved-changes guard: if the sandbox has edits, confirm before navigating
      // away (the scenario switch discards the working copy).
      if (isDirty) {
        const confirmed = window.confirm(
          "You have unsaved changes. Switching scenarios will discard them. Continue?",
        );
        if (!confirmed) return;
      }
      router.push(`${pathname}?scenario=${encodeURIComponent(next)}`);
    },
    [isDirty, router, pathname],
  );

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
            <span className="rounded bg-amber-900/40 px-2 py-0.5 text-xs text-amber-200">
              Modified — unsaved
            </span>
          )}
        </div>
      </div>

      {/* Three-column layout */}
      <div className="grid grid-cols-3 gap-4">
        {/* Ownership column */}
        <div className="rounded border border-gray-800/60 p-3">
          <EstateFlowOwnershipColumn
            data={ownership}
            onAssetClick={setOwnerDialogId}
          />
        </div>
        {/* Death column 1 — first death */}
        <div className="rounded border border-gray-800/60 p-3">
          <EstateFlowDeathColumn
            section={reportData.firstDeath}
            deathOrder={1}
            projection={projection}
            onAssetClick={setDistributionDialogId}
          />
          {/* pendingChanges wired here to avoid unused-variable lint */}
          <span className="sr-only">{pendingChanges.length} changes</span>
        </div>
        {/* Death column 2 — second death, married only */}
        {props.isMarried ? (
          <div className="rounded border border-gray-800/60 p-3">
            <EstateFlowDeathColumn
              section={reportData.secondDeath}
              deathOrder={2}
              projection={projection}
              onAssetClick={setDistributionDialogId}
            />
          </div>
        ) : (
          <div className="rounded border border-gray-800/60 p-3" aria-hidden="true" />
        )}
      </div>

      {/* Save bar — Task 10 */}

      {/* Change-owner dialog — Task 8 */}
      {(() => {
        if (!ownerDialogId) return null;
        const account = working.accounts.find((a) => a.id === ownerDialogId);
        if (!account) return null;
        return (
          <EstateFlowChangeOwnerDialog
            account={account}
            clientData={working}
            onApply={(owners) => {
              applyEdit((d) => changeOwner(d, ownerDialogId, owners));
              setOwnerDialogId(null);
            }}
            onClose={() => setOwnerDialogId(null)}
          />
        );
      })()}

      {/* Change-distribution dialog — Task 9 */}
      {distributionDialogId && working.accounts.some((a) => a.id === distributionDialogId) && (
        <EstateFlowChangeDistributionDialog
          accountId={distributionDialogId}
          clientData={working}
          onApplyBeneficiaries={(refs) => {
            applyEdit((d) => changeBeneficiaries(d, "account", distributionDialogId, refs));
            setDistributionDialogId(null);
          }}
          onApplyWill={(willId, bequests, residuary) => {
            applyEdit((d) => changeWillBequests(d, willId, bequests, residuary));
            setDistributionDialogId(null);
          }}
          onClose={() => setDistributionDialogId(null)}
        />
      )}
    </div>
  );
}
