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
import { baseWritesForChange } from "@/lib/estate/estate-flow-base-writes";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
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

  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const writer = useScenarioWriter(props.clientId);

  // A named scenario is active when scenarioId is set and is not the base case.
  const isNamedScenario = props.scenarioId !== "base";

  // `ordering` is NOT passed to runProjectionWithEvents — the projection always
  // computes both first-death and second-death sections from the data.
  // `ordering` is a display-time selector consumed by the death-column
  // components to decide which death feeds which column: when "primaryFirst",
  // column 1 shows the client's death and column 2 shows the spouse's death;
  // "spouseFirst" swaps them. The projection result is identical either way.
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

  const { submit } = writer;
  const handleSaveInPlace = useCallback(async () => {
    if (pendingChanges.length === 0) return;

    // ── Named scenario: store edits as overlay rows via the unified route. ──
    if (isNamedScenario) {
      setIsSaving(true);
      setSaveError(null);
      try {
        let saved = 0;
        for (const change of pendingChanges) {
          // baseFallback is a dummy — writer routes to the changes API in scenario mode.
          const res = await submit(change.edit, { url: "", method: "PATCH" });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            const apiMsg =
              typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
            const prefix =
              saved > 0
                ? `${saved} of ${pendingChanges.length} change(s) saved. `
                : "";
            setSaveError(`${prefix}Save failed: ${apiMsg}`);
            return;
          }
          saved++;
        }
        // router.refresh() is called by writer.submit on every successful submit,
        // which reloads initialClientData and clears the dirty badge.
      } finally {
        setIsSaving(false);
      }
      return;
    }

    // ── Base case: write directly to the client's real account/will data. ──
    const confirmed = window.confirm(
      "This will update the client's actual account ownership, beneficiary, " +
        "and will data. Continue?",
    );
    if (!confirmed) return;

    setIsSaving(true);
    setSaveError(null);
    try {
      const writes = pendingChanges.flatMap((c) =>
        baseWritesForChange(c, props.clientId),
      );
      let done = 0;
      for (const w of writes) {
        const res = await fetch(w.url, {
          method: w.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(w.body),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const apiMsg =
            typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
          const prefix =
            done > 0 ? `${done} of ${writes.length} write(s) saved. ` : "";
          setSaveError(`${prefix}Save failed: ${apiMsg}`);
          return;
        }
        done++;
      }
      // Reload initialClientData so `original` catches up to `working` and the
      // dirty badge clears — same mechanism the scenario path relies on.
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }, [pendingChanges, isNamedScenario, submit, props.clientId, router]);

  const handleSaveAsNew = useCallback(async () => {
    if (pendingChanges.length === 0) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const today = new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const newName = `Estate Flow — ${today}`;

      const createRes = await fetch(`/api/clients/${props.clientId}/scenarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          copyFrom: isNamedScenario ? props.scenarioId : "base",
        }),
      });
      if (!createRes.ok) {
        const body = await createRes.json().catch(() => ({}));
        const msg =
          typeof body?.error === "string"
            ? body.error
            : `Failed to create scenario (HTTP ${createRes.status})`;
        setSaveError(msg);
        return;
      }
      const { scenario } = await createRes.json();
      const newScenarioId: string = scenario.id;

      for (const change of pendingChanges) {
        const { edit } = change;
        const body: Record<string, unknown> = {
          op: edit.op,
          targetKind: edit.targetKind,
          targetId: edit.targetId,
          desiredFields: edit.desiredFields,
        };
        const res = await fetch(
          `/api/clients/${props.clientId}/scenarios/${newScenarioId}/changes`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) {
          const resBody = await res.json().catch(() => ({}));
          const msg =
            typeof resBody?.error === "string"
              ? resBody.error
              : `Change save failed (HTTP ${res.status})`;
          // Attempt to clean up the orphaned (partial) scenario before surfacing
          // the error. A failed cleanup should not mask the original error.
          try {
            await fetch(
              `/api/clients/${props.clientId}/scenarios/${newScenarioId}`,
              { method: "DELETE" },
            );
          } catch {
            // Cleanup failure is intentionally swallowed.
          }
          setSaveError(msg);
          return;
        }
      }

      router.push(`${pathname}?scenario=${encodeURIComponent(newScenarioId)}`);
    } finally {
      setIsSaving(false);
    }
  }, [pendingChanges, props.clientId, props.scenarioId, isNamedScenario, router, pathname]);

  const ownerDialogAccount = ownerDialogId
    ? working.accounts.find((a) => a.id === ownerDialogId)
    : undefined;

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
              <ScenarioPickerDropdown
                value={props.scenarioId}
                onChange={handleScenarioChange}
                scenarios={props.scenarios}
                snapshots={props.snapshots}
                ariaLabel="Scenario"
              />
            </div>
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
        {/* Death columns — ordering toggle swaps which section feeds column 2 vs 3 */}
        {(() => {
          const [col2Section, col3Section] =
            ordering === "spouseFirst"
              ? [reportData.secondDeath, reportData.firstDeath]
              : [reportData.firstDeath, reportData.secondDeath];
          return (
            <>
              <div className="rounded border border-gray-800/60 p-3">
                <EstateFlowDeathColumn
                  section={col2Section}
                  deathOrder={1}
                  projection={projection}
                  onAssetClick={setDistributionDialogId}
                />
              </div>
              {/* Death column 3 — second death, married only */}
              {props.isMarried ? (
                <div className="rounded border border-gray-800/60 p-3">
                  <EstateFlowDeathColumn
                    section={col3Section}
                    deathOrder={2}
                    projection={projection}
                    onAssetClick={setDistributionDialogId}
                  />
                </div>
              ) : (
                <div className="rounded border border-gray-800/60 p-3" aria-hidden="true" />
              )}
            </>
          );
        })()}
      </div>

      {isDirty && (
        <div
          role="region"
          aria-label="Unsaved changes"
          className="sticky bottom-0 z-20 rounded border border-amber-700/60 bg-[#1a1509] px-4 py-3 shadow-lg"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            {/* Change list */}
            <div className="min-w-0">
              <p className="mb-1.5 text-xs font-semibold text-amber-300">
                Unsaved changes ({pendingChanges.length})
              </p>
              <ul className="space-y-0.5">
                {pendingChanges.map((c, i) => (
                  <li key={i} className="text-xs text-amber-200/80">
                    &bull; {c.description}
                  </li>
                ))}
              </ul>
              {saveError && (
                <p role="alert" className="mt-2 text-xs font-medium text-red-400">
                  {saveError}
                </p>
              )}
            </div>
            {/* Action buttons */}
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSaveInPlace}
                className="rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-[#0b0c0f] transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving
                  ? "Saving…"
                  : isNamedScenario
                    ? "Save to this scenario"
                    : "Save to base plan"}
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSaveAsNew}
                className="rounded border border-amber-600 px-3 py-1.5 text-xs font-semibold text-amber-300 transition-colors hover:border-amber-500 hover:text-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? "Saving…" : "Save as new scenario"}
              </button>
            </div>
          </div>
        </div>
      )}

      {ownerDialogAccount && (
        <EstateFlowChangeOwnerDialog
          account={ownerDialogAccount}
          clientData={working}
          onApply={(owners) => {
            applyEdit((d) => changeOwner(d, ownerDialogId!, owners));
            setOwnerDialogId(null);
          }}
          onClose={() => setOwnerDialogId(null)}
        />
      )}

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
