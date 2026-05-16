"use client";

import { useMemo, useState } from "react";
import { buildOwnershipColumn } from "@/lib/estate/estate-flow-ownership";
import { EstateFlowOwnershipColumn } from "@/components/estate-flow-ownership-column";
import { EstateFlowDeathColumn } from "@/components/estate-flow-death-column";
import { buildEstateTransferReportData } from "@/lib/estate/transfer-report";
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

  const [ownerDialogId, setOwnerDialogId] = useState<string | null>(null);
  const [entityDialogId, setEntityDialogId] = useState<string | null>(null);
  const [distributionDialogId, setDistributionDialogId] = useState<string | null>(null);
  // Standalone "Add a gift" dialog (no source account).
  const [addGiftOpen, setAddGiftOpen] = useState(false);
  // Gift currently being edited via a column-1 future-gift marker.
  const [editingGiftId, setEditingGiftId] = useState<string | null>(null);

  // ── Memos ────────────────────────────────────────────────────────────────────
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
        ownerNames,
      }),
    [projection, ordering, engineData, ownerNames],
  );

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
      {/* Three-column layout */}
      <div className="grid grid-cols-3 gap-4">
        {/* Ownership column */}
        <div className="rounded border border-gray-800/60 p-3">
          <EstateFlowOwnershipColumn
            data={ownership}
            onAssetClick={(id, rowKind) => {
              if (rowKind === "business-entity") setEntityDialogId(id);
              else setOwnerDialogId(id);
            }}
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
