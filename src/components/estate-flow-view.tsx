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
import EstateFlowRemainderDialog from "@/components/estate-flow-remainder-dialog";
import { changeOwner, changeBeneficiaries, upsertWills } from "@/lib/estate/estate-flow-edits";
import { baseWritesForChange } from "@/lib/estate/estate-flow-base-writes";
import {
  addGift,
  updateGift,
  removeGift,
  applyGiftsToClientData,
  type EstateFlowGift,
} from "@/lib/estate/estate-flow-gifts";
import { diffGifts, type GiftChange } from "@/lib/estate/estate-flow-gift-diff";
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

// ── Gift persistence ─────────────────────────────────────────────────────────

/**
 * Map a single GiftChange onto the existing gift API routes and issue the
 * request. Mirrors the body shapes in the DROP form's save-handlers.ts.
 *
 * - cash-once / asset-once → /gifts and /gifts/:id
 * - series                → /gifts/series and /gifts/series/:id
 *
 * The client-generated `id` is never sent on POST — the route assigns one.
 * On PATCH, the immutable `accountId` is omitted (the gift routes reject it).
 * `eventKind` is omitted entirely: the POST route rejects any non-"outright"
 * value, and the PATCH route ignores the field — sandbox gifts are outright.
 */
async function persistGiftChange(
  clientId: string,
  change: GiftChange,
): Promise<Response> {
  const { op, gift } = change;

  // ── series ────────────────────────────────────────────────────────────────
  if (gift.kind === "series") {
    if (op === "remove") {
      return fetch(`/api/clients/${clientId}/gifts/series/${gift.id}`, {
        method: "DELETE",
      });
    }
    const body = {
      grantor: gift.grantor,
      recipientEntityId: gift.recipient.id,
      startYear: gift.startYear,
      startYearRef: null,
      endYear: gift.endYear,
      endYearRef: null,
      annualAmount: gift.annualAmount,
      inflationAdjust: gift.inflationAdjust,
      useCrummeyPowers: gift.crummey,
      notes: null,
    };
    return fetch(
      op === "add"
        ? `/api/clients/${clientId}/gifts/series`
        : `/api/clients/${clientId}/gifts/series/${gift.id}`,
      {
        method: op === "add" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }

  // ── cash-once / asset-once ────────────────────────────────────────────────
  if (op === "remove") {
    return fetch(`/api/clients/${clientId}/gifts/${gift.id}`, {
      method: "DELETE",
    });
  }

  // Common one-time fields. accountId is included only on POST (it is immutable
  // and rejected by the PATCH schema).
  const recipientFields = {
    recipientEntityId:
      gift.recipient.kind === "entity" ? gift.recipient.id : null,
    recipientFamilyMemberId:
      gift.recipient.kind === "family_member" ? gift.recipient.id : null,
    recipientExternalBeneficiaryId:
      gift.recipient.kind === "external_beneficiary" ? gift.recipient.id : null,
  };
  const oneTimeBody: Record<string, unknown> = {
    year: gift.year,
    yearRef: null,
    grantor: gift.grantor,
    ...recipientFields,
    notes: null,
  };
  if (gift.kind === "cash-once") {
    oneTimeBody.amount = gift.amount;
    oneTimeBody.useCrummeyPowers = gift.crummey;
    if (op === "add") oneTimeBody.accountId = null;
  } else {
    // asset-once: percent transfer of a source account. Asset gifts have no
    // Crummey concept — the DROP form sends useCrummeyPowers: false.
    oneTimeBody.percent = gift.percent;
    oneTimeBody.useCrummeyPowers = false;
    if (op === "add") oneTimeBody.accountId = gift.accountId;
  }

  return fetch(
    op === "add"
      ? `/api/clients/${clientId}/gifts`
      : `/api/clients/${clientId}/gifts/${gift.id}`,
    {
      method: op === "add" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(oneTimeBody),
    },
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
  // Residuary ("remainder estate") clause dialog.
  const [remainderDialogOpen, setRemainderDialogOpen] = useState(false);
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
  // reflect existing and sandbox-edited gifts. The loader strips
  // gifts/giftEvents from initialClientData; they flow back in here.
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
  }, [working.familyMembers, working.entities, working.externalBeneficiaries]);
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

  // Resync the gift sandbox to the server baseline whenever `initialGifts`
  // changes identity. `initialGifts` is a server-component prop: it is
  // referentially stable between renders and only changes on `router.refresh()`
  // (after a save) or a scenario navigation — exactly the moments the sandbox
  // SHOULD adopt the new baseline. Local edits never change the prop identity,
  // so a mid-edit sandbox is never clobbered. Without this, gifts added in this
  // session keep their client-generated UUIDs after a save while the refreshed
  // `initialGifts` carries the server-assigned ids — `diffGifts` would then see
  // every saved gift as a phantom `add` forever, re-POSTing duplicates.
  useEffect(() => {
    setWorkingGifts(props.initialGifts);
  }, [props.initialGifts]);

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
    if (pendingChanges.length === 0 && giftChanges.length === 0) return;

    // The base-case overlay channel writes directly to the client's real
    // account/will data — confirm first. Gift-only edits never touch that
    // data, so the confirm is gated on there being base-mode overlay writes.
    if (!isNamedScenario && pendingChanges.length > 0) {
      const confirmed = window.confirm(
        "This will update the client's actual account ownership, beneficiary, " +
          "and will data. Continue?",
      );
      if (!confirmed) return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      // Total spans both channels so the "{n} of {total}" prefix is accurate.
      const total = pendingChanges.length + giftChanges.length;
      let saved = 0;
      // Tracks whether any HTTP request that does NOT self-refresh has gone
      // out (base-mode overlay writes + gift writes). When true we issue an
      // explicit router.refresh() at the end; the scenario-overlay path
      // refreshes itself via writer.submit.
      let needsExplicitRefresh = false;

      // ── Overlay channel ─────────────────────────────────────────────────
      if (isNamedScenario) {
        // Named scenario: store edits as overlay rows via the unified route.
        // writer.submit calls router.refresh() after every successful submit.
        for (const change of pendingChanges) {
          // baseFallback is a dummy — writer routes to the changes API in scenario mode.
          const res = await submit(change.edit, { url: "", method: "PATCH" });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            const apiMsg =
              typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
            const prefix = saved > 0 ? `${saved} of ${total} change(s) saved. ` : "";
            setSaveError(`${prefix}Save failed: ${apiMsg}`);
            return;
          }
          saved++;
        }
      } else if (pendingChanges.length > 0) {
        // Base case: write directly to the client's real account/will data.
        const writes = pendingChanges.flatMap((c) =>
          baseWritesForChange(c, props.clientId),
        );
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
            const prefix = saved > 0 ? `${saved} of ${total} change(s) saved. ` : "";
            setSaveError(`${prefix}Save failed: ${apiMsg}`);
            // Refresh so already-persisted writes reload as the new baseline.
            router.refresh();
            return;
          }
          needsExplicitRefresh = true;
          // Count once per change once all its writes succeed is impractical
          // here — count per write; `total` is change-based, so this prefix is
          // approximate but only ever shown on a partial failure.
          saved++;
        }
      }

      // ── Gift channel ────────────────────────────────────────────────────
      // Runs on ANY scenario (including base): gift routes are not overlay
      // calls. cash/asset gift rows are client-global; series resolve the
      // base-case scenario server-side.
      //
      // On a partial failure we still want to refresh so the gifts that DID
      // persist reload into `initialGifts` (with server ids) and drop out of
      // `giftChanges` — otherwise a re-save would re-POST them as phantom
      // `add`s (their client UUIDs are still absent from `initialGifts`).
      for (const change of giftChanges) {
        needsExplicitRefresh = true;
        const res = await persistGiftChange(props.clientId, change);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const apiMsg =
            typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
          const prefix = saved > 0 ? `${saved} of ${total} change(s) saved. ` : "";
          setSaveError(`${prefix}Save failed: ${apiMsg}`);
          // Refresh so already-persisted gifts reload as the new baseline,
          // then surface the error. The error stays set across the refresh.
          router.refresh();
          return;
        }
        saved++;
      }

      // writer.submit refreshes after each overlay edit, but base-mode writes
      // and the gift routes do not — an explicit refresh reloads
      // initialGifts/initialClientData and clears the dirty badge.
      if (needsExplicitRefresh) router.refresh();
    } catch {
      setSaveError("Network error while saving — please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [pendingChanges, giftChanges, isNamedScenario, submit, props.clientId, router]);

  const handleSaveAsNew = useCallback(async () => {
    if (pendingChanges.length === 0 && giftChanges.length === 0) return;
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

      // ── Gift channel ────────────────────────────────────────────────────
      // Gift rows are client-global (cash/asset) or resolve the base-case
      // scenario server-side (series) — they persist the same regardless of
      // the fork. Run after the overlay writes succeed. A gift failure here
      // leaves the (valid) new scenario in place: the scenario itself is
      // sound, and the partially-persisted gifts cannot be cleanly rolled
      // back, so the error is surfaced without deleting the scenario.
      for (const change of giftChanges) {
        const res = await persistGiftChange(props.clientId, change);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const apiMsg =
            typeof body?.error === "string"
              ? body.error
              : `Gift save failed (HTTP ${res.status})`;
          // The new scenario already exists with its overlay changes written.
          // Tell the advisor so they know where to retry — the scenario is
          // sound and is intentionally left in place (no rollback).
          setSaveError(
            `Scenario "${newName}" was created and its changes saved, but a gift failed to save: ${apiMsg}. Open that scenario to retry the gift.`,
          );
          return;
        }
      }

      router.push(`${pathname}?scenario=${encodeURIComponent(newScenarioId)}`);
    } catch {
      setSaveError("Network error while saving — please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [pendingChanges, giftChanges, props.clientId, props.scenarioId, isNamedScenario, router, pathname]);

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
          <button
            type="button"
            onClick={() => setRemainderDialogOpen(true)}
            className="rounded border border-[#1f2024] px-3 py-1.5 text-xs font-medium text-[#e7e6e2] transition-colors hover:border-[#3a3b40] hover:bg-[#1f2024]"
          >
            Remainder estate
          </button>
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
              {/*
                "Save in place" persists overlay edits (named scenario → overlay
                rows; base case → direct writes to the client's real data) AND
                gift changes (any scenario — gift routes write the gifts tables
                directly). The panel only renders when `isDirty`, so the button
                always has something to persist here.
              */}
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
          ledger={projection.giftLedger}
          taxInflationRate={taxInflationRate}
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
          onApplyWill={(wills) => {
            applyEdit((d) => upsertWills(d, wills));
            setDistributionDialogId(null);
          }}
          onClose={() => setDistributionDialogId(null)}
        />
      )}

      {/* Residuary ("remainder estate") clause dialog. */}
      {remainderDialogOpen && (
        <EstateFlowRemainderDialog
          clientData={working}
          isMarried={props.isMarried}
          ownerNames={props.ownerNames}
          onApplyWill={(wills) => {
            applyEdit((d) => upsertWills(d, wills));
            setRemainderDialogOpen(false);
          }}
          onClose={() => setRemainderDialogOpen(false)}
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
