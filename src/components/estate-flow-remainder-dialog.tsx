"use client";

import { useMemo, useState } from "react";
import DialogShell from "@/components/dialog-shell";
import WillRecipientList, {
  type WillRecipientRow,
} from "@/components/estate-flow-will-recipient-list";
import type { ClientData, Will, WillResiduaryRecipient } from "@/engine/types";

interface Props {
  clientData: ClientData;
  isMarried: boolean;
  ownerNames: { clientName: string; spouseName: string | null };
  /** Receives the will(s) to upsert into the working ClientData. */
  onApplyWill: (wills: Will[]) => void;
  onClose: () => void;
}

let _key = 0;
const newKey = () => `rmd-${++_key}-${Math.random().toString(36).slice(2, 7)}`;
const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Convert engine residuary recipients of a single tier into editable rows. */
function toRows(
  recipients: WillResiduaryRecipient[] | undefined,
  tier: "primary" | "contingent",
): WillRecipientRow[] {
  return (recipients ?? [])
    .filter((r) => (r.tier ?? "primary") === tier)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => ({
      key: newKey(),
      recipientKind: r.recipientKind,
      recipientId: r.recipientId,
      percentage: r.percentage,
      sortOrder: r.sortOrder,
    }));
}

function rowsToRecipients(
  rows: WillRecipientRow[],
  tier: "primary" | "contingent",
  startSort: number,
): WillResiduaryRecipient[] {
  return rows.map((r, i) => ({
    recipientKind: r.recipientKind,
    recipientId: r.recipientId,
    tier,
    percentage: r.percentage,
    sortOrder: startSort + i,
  }));
}

/** A tier is valid when it is empty, or its percentages sum to 100 and every
 *  row resolves to a recipient (spouse rows carry a null id by design). */
function tierValid(rows: WillRecipientRow[]): boolean {
  if (rows.length === 0) return true;
  const sum = rows.reduce((s, r) => s + r.percentage, 0);
  const idsOk = rows.every(
    (r) => r.recipientKind === "spouse" || r.recipientId != null,
  );
  return idsOk && Math.abs(sum - 100) < 0.5;
}

/**
 * Edits both wills' remainder (residuary) clauses in one dialog. Each will
 * gets a Primary tier; married households also get a Contingent tier. Apply
 * emits the upserted `Will[]` via `onApplyWill`.
 */
export default function EstateFlowRemainderDialog({
  clientData,
  isMarried,
  ownerNames,
  onApplyWill,
  onClose,
}: Props) {
  const clientWill = useMemo(
    () => (clientData.wills ?? []).find((w) => w.grantor === "client"),
    [clientData.wills],
  );
  const spouseWill = useMemo(
    () => (clientData.wills ?? []).find((w) => w.grantor === "spouse"),
    [clientData.wills],
  );

  // Recipient option lists — exclude the household principals from family
  // members; trusts only for entities. Mirrors estate-flow-change-distribution-dialog.
  const familyMembers = useMemo(
    () =>
      (clientData.familyMembers ?? []).filter(
        (m) => m.role !== "client" && m.role !== "spouse",
      ),
    [clientData.familyMembers],
  );
  const familyOptions = familyMembers.map((fm) => ({
    id: fm.id,
    label: `${fm.firstName} ${fm.lastName ?? ""}`.trim(),
  }));
  const externalOptions = (clientData.externalBeneficiaries ?? []).map((x) => ({
    id: x.id,
    label: x.name,
  }));
  const entityOptions = (clientData.entities ?? [])
    .filter((e) => e.entityType === "trust")
    .map((e) => ({ id: e.id, label: e.name ?? "" }));
  const childMembers = familyMembers
    .filter((m) => m.relationship === "child")
    .map((m) => ({ id: m.id }));

  // Seed editable rows once at mount — `toRows` mints fresh keys, so the
  // initializers must not re-run on every render.
  const [clientPrimary, setClientPrimary] = useState<WillRecipientRow[]>(() =>
    toRows(clientWill?.residuaryRecipients, "primary"),
  );
  const [clientContingent, setClientContingent] = useState<WillRecipientRow[]>(
    () => toRows(clientWill?.residuaryRecipients, "contingent"),
  );
  const [spousePrimary, setSpousePrimary] = useState<WillRecipientRow[]>(() =>
    toRows(spouseWill?.residuaryRecipients, "primary"),
  );
  const [spouseContingent, setSpouseContingent] = useState<WillRecipientRow[]>(
    () => toRows(spouseWill?.residuaryRecipients, "contingent"),
  );

  const canApply =
    tierValid(clientPrimary) &&
    tierValid(clientContingent) &&
    (!isMarried || (tierValid(spousePrimary) && tierValid(spouseContingent)));

  function handleApply() {
    if (!canApply) return;

    const wills: Will[] = [];

    const clientRecipients = [
      ...rowsToRecipients(clientPrimary, "primary", 0),
      ...rowsToRecipients(clientContingent, "contingent", clientPrimary.length),
    ];
    if (clientRecipients.length > 0 || clientWill) {
      wills.push({
        id: clientWill?.id ?? newId(),
        grantor: "client",
        bequests: clientWill?.bequests ?? [],
        residuaryRecipients: clientRecipients,
      });
    }

    if (isMarried) {
      const spouseRecipients = [
        ...rowsToRecipients(spousePrimary, "primary", 0),
        ...rowsToRecipients(spouseContingent, "contingent", spousePrimary.length),
      ];
      if (spouseRecipients.length > 0 || spouseWill) {
        wills.push({
          id: spouseWill?.id ?? newId(),
          grantor: "spouse",
          bequests: spouseWill?.bequests ?? [],
          residuaryRecipients: spouseRecipients,
        });
      }
    }

    onApplyWill(wills);
  }

  return (
    <DialogShell
      open={true}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Remainder estate"
      size="md"
      primaryAction={{ label: "Apply", onClick: handleApply, disabled: !canApply }}
    >
      <p className="mb-4 text-[12px] text-ink-3">
        The remainder clause routes everything a will&apos;s specific bequests
        leave behind. The primary tier governs when the spouse survives the
        grantor; the contingent tier governs when the spouse predeceased.
      </p>

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold text-ink-1">
          {ownerNames.clientName}&apos;s will
        </h3>
        <WillRecipientList
          label="Primary — if spouse survives"
          sumMsgId="rmd-client-primary"
          rows={clientPrimary}
          onChange={setClientPrimary}
          spouseName={ownerNames.spouseName}
          familyMembers={familyOptions}
          externalBeneficiaries={externalOptions}
          entities={entityOptions}
          childMembers={childMembers}
          recipientAriaLabel="Client primary remainder recipient"
        />
        {isMarried && (
          <div className="mt-3">
            <WillRecipientList
              label="Contingent — if spouse predeceased"
              sumMsgId="rmd-client-contingent"
              rows={clientContingent}
              onChange={setClientContingent}
              spouseName={ownerNames.spouseName}
              familyMembers={familyOptions}
              externalBeneficiaries={externalOptions}
              entities={entityOptions}
              childMembers={childMembers}
              recipientAriaLabel="Client contingent remainder recipient"
            />
          </div>
        )}
      </section>

      {isMarried && ownerNames.spouseName && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink-1">
            {ownerNames.spouseName}&apos;s will
          </h3>
          <WillRecipientList
            label="Primary — if spouse survives"
            sumMsgId="rmd-spouse-primary"
            rows={spousePrimary}
            onChange={setSpousePrimary}
            spouseName={ownerNames.clientName}
            familyMembers={familyOptions}
            externalBeneficiaries={externalOptions}
            entities={entityOptions}
            childMembers={childMembers}
            recipientAriaLabel="Spouse primary remainder recipient"
          />
          <div className="mt-3">
            <WillRecipientList
              label="Contingent — if spouse predeceased"
              sumMsgId="rmd-spouse-contingent"
              rows={spouseContingent}
              onChange={setSpouseContingent}
              spouseName={ownerNames.clientName}
              familyMembers={familyOptions}
              externalBeneficiaries={externalOptions}
              entities={entityOptions}
              childMembers={childMembers}
              recipientAriaLabel="Spouse contingent remainder recipient"
            />
          </div>
        </section>
      )}
    </DialogShell>
  );
}
