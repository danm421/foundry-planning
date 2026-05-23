"use client";

import { useMemo, useState } from "react";
import { buildOwnershipColumn } from "@/lib/estate/estate-flow-ownership";
import { EstateFlowOwnershipColumn } from "@/components/estate-flow-ownership-column";
import { EstateFlowDeathColumn } from "@/components/estate-flow-death-column";
import { buildEstateTransferReportData } from "@/lib/estate/transfer-report";
import { AsOfDropdown, type AsOfValue } from "@/components/report-controls/as-of-dropdown";
import {
  asOfSelectionFor,
  pickDeathColumns,
} from "@/lib/estate/estate-flow-death-columns";
import EstateFlowChangeOwnerDialog from "@/components/estate-flow-change-owner-dialog";
import EstateFlowChangeDistributionDialog from "@/components/estate-flow-change-distribution-dialog";
import EstateFlowAddGiftDialog from "@/components/estate-flow-add-gift-dialog";
import EstateFlowChangeEntityOwnerDialog from "@/components/estate-flow-change-entity-owner-dialog";
import { changeOwner, changeBeneficiaries, upsertWills, changeEntityOwners } from "@/lib/estate/estate-flow-edits";
import {
  addGift,
  updateGift,
  removeGift,
  type EstateFlowGift,
} from "@/lib/estate/estate-flow-gifts";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";

export interface EstateFlowReportTabProps {
  working: ClientData;
  workingGifts: EstateFlowGift[];
  projection: ProjectionResult;
  engineData: ClientData;
  ordering: "primaryFirst" | "spouseFirst";
  isMarried: boolean;
  ownerNames: { clientName: string; spouseName: string | null };
  planStartYear: number;
  planEndYear: number;
  applyEdit: (fn: (d: ClientData) => ClientData) => void;
  setWorkingGifts: React.Dispatch<React.SetStateAction<EstateFlowGift[]>>;
}

export function EstateFlowReportTab({
  working,
  workingGifts,
  projection,
  engineData,
  ordering,
  isMarried,
  ownerNames,
  planStartYear,
  planEndYear,
  applyEdit,
  setWorkingGifts,
}: EstateFlowReportTabProps) {
  // ── Tab-local state ──────────────────────────────────────────────────────────
  const [asOfYear, setAsOfYear] = useState<number>(planStartYear);
  // As-of selection for the two death columns. "split" (each death at its
  // actual projected year) preserves the report's original behavior; a year
  // or "today" shows the hypothetical "both die then" scenario.
  const [deathAsOf, setDeathAsOf] = useState<AsOfValue>("split");

  const [ownerDialogId, setOwnerDialogId] = useState<string | null>(null);
  const [entityDialogId, setEntityDialogId] = useState<string | null>(null);
  const [distributionDialogId, setDistributionDialogId] = useState<string | null>(null);
  // Standalone "Add a gift" dialog (no source account).
  const [addGiftOpen, setAddGiftOpen] = useState(false);
  // Gift currently being edited via a column-1 future-gift marker.
  const [editingGiftId, setEditingGiftId] = useState<string | null>(null);

  // ── Memos ────────────────────────────────────────────────────────────────────
  const ownership = useMemo(
    () =>
      buildOwnershipColumn(working, {
        projection,
        asOfYear,
        todayYear: planStartYear,
        gifts: workingGifts,
      }),
    [working, projection, asOfYear, planStartYear, workingGifts],
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
        asOf: asOfSelectionFor(deathAsOf),
        ordering,
        clientData: engineData,
        ownerNames,
      }),
    [projection, deathAsOf, ordering, engineData, ownerNames],
  );

  // ── Death-column as-of dropdown inputs ───────────────────────────────────────
  const dropdownYears = useMemo(
    () => projection.years.map((y) => y.year),
    [projection.years],
  );
  const todayYear = projection.years[0]?.year ?? planStartYear;

  const ownerDobs = useMemo(
    () => ({
      clientDob: working.client.dateOfBirth,
      spouseDob: working.client.spouseDob ?? null,
    }),
    [working.client.dateOfBirth, working.client.spouseDob],
  );

  // Retirement / death-year shortcuts surfaced at the top of the dropdown.
  const deathAsOfMilestones = useMemo(() => {
    const c = working.client;
    const clientRetirementYear =
      parseInt(c.dateOfBirth.slice(0, 4), 10) + c.retirementAge;
    const spouseRetirementYear =
      c.spouseDob && c.spouseRetirementAge != null
        ? parseInt(c.spouseDob.slice(0, 4), 10) + c.spouseRetirementAge
        : null;
    const retirementYear =
      spouseRetirementYear != null
        ? Math.max(clientRetirementYear, spouseRetirementYear)
        : clientRetirementYear;
    const firstDeathYear = projection.firstDeathEvent?.year;
    const secondDeathYear = projection.secondDeathEvent?.year;
    return [
      { year: retirementYear, label: "Retirement" },
      ...(firstDeathYear != null
        ? [{ year: firstDeathYear, label: "First Death" }]
        : []),
      ...(secondDeathYear != null
        ? [{ year: secondDeathYear, label: "Last Death" }]
        : []),
    ];
  }, [working.client, projection.firstDeathEvent, projection.secondDeathEvent]);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const ownerDialogAccount = ownerDialogId
    ? working.accounts.find((a) => a.id === ownerDialogId)
    : undefined;
  const entityDialogEntity = entityDialogId
    ? (working.entities ?? []).find((e) => e.id === entityDialogId)
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

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Death-column as-of selector — aligned over the two death columns */}
      <div className="mb-3 grid grid-cols-3 gap-4">
        <label className="col-span-2 col-start-2 flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-gray-500">
            Death columns as of
          </span>
          <AsOfDropdown
            years={dropdownYears}
            todayYear={todayYear}
            selected={deathAsOf}
            onChange={setDeathAsOf}
            dobs={ownerDobs}
            milestones={deathAsOfMilestones}
            allowSplit
            yearPrefix={isMarried ? "Both die in" : "Die in"}
            ariaLabel="Death columns as of"
          />
        </label>
      </div>

      {/* Three-column layout */}
      <div className="grid grid-cols-3 gap-4">
        {/* Ownership column */}
        <div className="rounded border border-gray-800/60 p-3">
          <EstateFlowOwnershipColumn
            data={ownership}
            onAssetClick={(id) => setOwnerDialogId(id)}
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
          const [col2Section, col3Section] = pickDeathColumns(
            reportData,
            deathAsOf,
            ordering,
          );
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
              {isMarried ? (
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

      {/* Dialogs */}
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
          onSeedBeneficiary={(ref) => {
            applyEdit((d) =>
              changeBeneficiaries(d, "account", ownerDialogId!, [ref]),
            );
          }}
          onApplyGift={(draft) => {
            setWorkingGifts((cur) => addGift(cur, draft));
            setOwnerDialogId(null);
          }}
          onClose={() => setOwnerDialogId(null)}
        />
      )}

      {entityDialogEntity && (
        <EstateFlowChangeEntityOwnerDialog
          entity={entityDialogEntity}
          clientData={working}
          onApply={(owners) => {
            applyEdit((d) => changeEntityOwners(d, entityDialogId!, owners));
            setEntityDialogId(null);
          }}
          onClose={() => setEntityDialogId(null)}
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
    </>
  );
}
