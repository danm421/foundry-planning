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
import EstateFlowAddGiftDialog from "@/components/estate-flow-add-gift-dialog";
import { changeOwner, changeBeneficiaries, changeWillBequests } from "@/lib/estate/estate-flow-edits";
import {
  addGift,
  updateGift,
  removeGift,
  applyGiftsToClientData,
  type EstateFlowGift,
} from "@/lib/estate/estate-flow-gifts";
import { diffGifts } from "@/lib/estate/estate-flow-gift-diff";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import type { ClientData } from "@/engine/types";

export interface EstateFlowViewProps {
  clientId: string;
  scenarioId: string;
  isMarried: boolean;
  ownerNames: { clientName: string; spouseName: string | null };
  initialClientData: ClientData;
  initialGifts: EstateFlowGift[];
  cpi: number;
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
  // Gift sandbox. New gifts are added via the change-owner dialog.
  const [workingGifts, setWorkingGifts] = useState<EstateFlowGift[]>(
    props.initialGifts,
  );
  const [ordering, setOrdering] =
    useState<"primaryFirst" | "spouseFirst">("primaryFirst");
  const [ownerDialogId, setOwnerDialogId] = useState<string | null>(null);
  const [distributionDialogId, setDistributionDialogId] = useState<string | null>(null);
  // Standalone "Add a gift" dialog (no source account).
  const [addGiftOpen, setAddGiftOpen] = useState(false);
  // Gift currently being edited via a column-1 future-gift marker.
  const [editingGiftId, setEditingGiftId] = useState<string | null>(null);

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
  // Materialise gift drafts into the engine input so the projection and report
  // reflect existing (and, in later tasks, sandbox-edited) gifts. The loader
  // strips gifts/giftEvents from initialClientData; they flow back in here.
  const engineData = useMemo(
    () => applyGiftsToClientData(working, workingGifts, props.cpi),
    [working, workingGifts, props.cpi],
  );
  const projection = useMemo(
    () => runProjectionWithEvents(engineData),
    [engineData],
  );

  // Plan year bounds, derived from the projection. `planStartYear` is "today".
  // Guard against an empty `years` array — fall back to the current calendar year.
  const planStartYear = projection.years[0]?.year ?? new Date().getFullYear();
  const planEndYear =
    projection.years[projection.years.length - 1]?.year ?? planStartYear;

  // As-of year for column 1. Initialises to the plan's first year ("today").
  const [asOfYear, setAsOfYear] = useState<number>(planStartYear);

  const ownership = useMemo(
    () => buildOwnershipColumn(working, { projection, asOfYear, gifts: workingGifts }),
    [working, projection, asOfYear, workingGifts],
  );

  // Human label for each gift recipient, keyed by recipient id. Built from the
  // working copy's family members / entities / external beneficiaries so the
  // ownership column can resolve future-gift markers.
  const recipientLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const fm of working.familyMembers ?? []) {
      map.set(
        fm.id,
        [fm.firstName, fm.lastName].filter(Boolean).join(" ") || fm.firstName,
      );
    }
    for (const entity of working.entities ?? []) {
      if (entity.name) map.set(entity.id, entity.name);
    }
    for (const ext of working.externalBeneficiaries ?? []) {
      map.set(ext.id, ext.name);
    }
    return map;
  }, [working]);
  // Account display names keyed by id — used by the death columns to resolve
  // asset-gift marker labels ("P% of {account name}").
  const accountNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const acct of working.accounts ?? []) {
      map.set(acct.id, acct.name);
    }
    return map;
  }, [working.accounts]);
  const reportData = useMemo(
    () =>
      buildEstateTransferReportData({
        projection,
        asOf: { kind: "split" },
        ordering,
        clientData: engineData,
        ownerNames: props.ownerNames,
      }),
    [projection, ordering, engineData, props.ownerNames],
  );
  const pendingChanges = useMemo(
    () => diffWorkingCopy(original, working),
    [original, working],
  );
  const giftChanges = useMemo(
    () => diffGifts(props.initialGifts, workingGifts),
    [props.initialGifts, workingGifts],
  );
  const isDirty = pendingChanges.length > 0 || giftChanges.length > 0;

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
  const handleSaveToScenario = useCallback(async () => {
    if (!isNamedScenario || pendingChanges.length === 0) return;
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
  }, [isNamedScenario, pendingChanges, submit]);

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

  // Plan tax-inflation rate, threaded to the gift-fields warning preview.
  const taxInflationRate =
    working.planSettings.taxInflationRate ??
    working.planSettings.inflationRate ??
    0;

  // The gift targeted by an open edit dialog. Undefined when the gift was
  // removed out from under the dialog — guarded at render time below.
  const editingGift = editingGiftId
    ? workingGifts.find((g) => g.id === editingGiftId)
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
            minYear={planStartYear}
            maxYear={planEndYear}
            asOfYear={asOfYear}
            onYearChange={setAsOfYear}
            gifts={workingGifts}
            recipientLabelById={recipientLabelById}
            onGiftClick={(giftId) => setEditingGiftId(giftId)}
            onAddGift={() => setAddGiftOpen(true)}
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
                  gifts={workingGifts}
                  accountNameById={accountNameById}
                  onGiftClick={setEditingGiftId}
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
                    gifts={workingGifts}
                    accountNameById={accountNameById}
                    onGiftClick={setEditingGiftId}
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
                Unsaved changes ({pendingChanges.length + giftChanges.length})
              </p>
              <ul className="space-y-0.5">
                {pendingChanges.map((c, i) => (
                  <li key={`overlay-${i}`} className="text-xs text-amber-200/80">
                    &bull; {c.description}
                  </li>
                ))}
                {giftChanges.map((c, i) => (
                  <li key={`gift-${i}`} className="text-xs text-amber-200/80">
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
              {isNamedScenario && (
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={handleSaveToScenario}
                  className="rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-[#0b0c0f] transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSaving ? "Saving…" : "Save to this scenario"}
                </button>
              )}
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
          ledger={projection.giftLedger}
          taxInflationRate={
            working.planSettings.taxInflationRate ??
            working.planSettings.inflationRate ??
            0
          }
          onApply={(owners) => {
            applyEdit((d) => changeOwner(d, ownerDialogId!, owners));
            setOwnerDialogId(null);
          }}
          onApplyGift={(draft) => {
            setWorkingGifts((cur) => addGift(cur, draft));
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

      {/* Standalone "Add a gift" dialog — sourceAccount is always null here. */}
      {addGiftOpen && (
        <EstateFlowAddGiftDialog
          clientData={working}
          ledger={projection.giftLedger}
          taxInflationRate={taxInflationRate}
          editing={null}
          onApply={(draft) => {
            setWorkingGifts((cur) => addGift(cur, draft));
            setAddGiftOpen(false);
          }}
          onDelete={() => {}}
          onClose={() => setAddGiftOpen(false)}
        />
      )}

      {/* Edit / delete an existing gift, opened from a column-1 marker. */}
      {editingGiftId && editingGift && (
        <EstateFlowAddGiftDialog
          key={editingGiftId}
          clientData={working}
          ledger={projection.giftLedger}
          taxInflationRate={taxInflationRate}
          editing={editingGift}
          onApply={(draft) => {
            setWorkingGifts((cur) => updateGift(cur, draft));
            setEditingGiftId(null);
          }}
          onDelete={() => {
            setWorkingGifts((cur) => removeGift(cur, editingGiftId));
            setEditingGiftId(null);
          }}
          onClose={() => setEditingGiftId(null)}
        />
      )}
    </div>
  );
}
