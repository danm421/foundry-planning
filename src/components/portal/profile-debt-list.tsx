"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReactElement } from "react";
import { fmtUsd } from "@/lib/portal/format";
import { LIABILITY_PLAID_LOCKED_FIELDS } from "@/lib/portal/plaid-locked-fields";
import { TYPE_LABEL } from "@/lib/portal/account-rail";
import {
  DebtFormPanel,
  debtOwnersFromForm,
  debtRowToForm,
  type DebtFormState,
} from "@/components/portal/debt-form-panel";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import type { PortalDebtRow } from "@/lib/portal/portal-networth";
import { DebtDetailPanel } from "@/components/portal/account-detail-panel";
import {
  PortalDetailPortal,
  announceDetailOpen,
  useCloseOnOtherDetail,
} from "@/components/portal/portal-detail-rail";

interface FamilyMember {
  id: string;
  firstName: string;
  lastName: string | null;
  role: string;
}

interface TrustEntity {
  id: string;
  name: string;
}

interface Props {
  rows: PortalDebtRow[];
  familyMembers: FamilyMember[];
  trustEntities: TrustEntity[];
  editEnabled: boolean;
}

export function ProfileDebtList({
  rows,
  familyMembers,
  trustEntities,
  editEnabled,
}: Props): ReactElement | null {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const portalFetch = usePortalFetch();
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<DebtFormState | null>(null);
  // Drill-down into the shared #portal-detail rail.
  const [detailRow, setDetailRow] = useState<PortalDebtRow | null>(null);
  const closeDetail = useCallback(() => setDetailRow(null), []);
  useCloseOnOtherDetail("debts", closeDetail);

  if (rows.length === 0) return null;

  const total = rows.reduce((s, r) => s + r.balance, 0);
  const inFlight = busy || isPending;
  const openRow = openId ? rows.find((r) => r.id === openId) ?? null : null;
  // A Plaid-linked debt's balance is synced — lock it (the PUT route also rejects it).
  const plaidLocked = openRow?.isPlaidLinked ?? false;

  function openEdit(row: PortalDebtRow) {
    setForm(debtRowToForm(row));
    setOpenId(row.id);
  }
  function cancel() {
    setOpenId(null);
    setForm(null);
  }

  async function submit() {
    if (!form || !openId) return;
    const owners = debtOwnersFromForm(form);
    if (owners.length === 0) {
      alert("Pick at least one owner.");
      return;
    }
    const body: Record<string, unknown> = {
      name: form.name,
      liabilityType: form.liabilityType,
      balance: form.balance,
      owners,
    };
    // Plaid owns balance on a linked debt — sending it would 400.
    if (plaidLocked) {
      for (const k of LIABILITY_PLAID_LOCKED_FIELDS) delete body[k];
    }
    setBusy(true);
    try {
      const res = await portalFetch(`/api/portal/liabilities/${openId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        alert(detail.error ?? "Save failed");
        return;
      }
      cancel();
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: PortalDebtRow) {
    if (!window.confirm(`Delete "${row.name}"?`)) return;
    setBusy(true);
    try {
      const res = await portalFetch(`/api/portal/liabilities/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        alert(detail.error ?? "Delete failed");
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  function ownerLabels(row: PortalDebtRow): string {
    const parts: string[] = [];
    for (const id of row.ownerFmIds) {
      const fm = familyMembers.find((m) => m.id === id);
      if (fm) parts.push(`${fm.firstName}${fm.lastName ? " " + fm.lastName : ""}`);
    }
    for (const id of row.ownerEntityIds) {
      const ent = trustEntities.find((t) => t.id === id);
      if (ent) parts.push(ent.name);
    }
    return parts.join(" + ");
  }

  return (
    <section className="space-y-2">
      {editEnabled && openRow && form && (
        <DebtFormPanel
          form={form}
          setForm={setForm}
          familyMembers={familyMembers}
          trustEntities={trustEntities}
          onCancel={cancel}
          onSubmit={submit}
          disabled={inFlight}
          plaidLocked={plaidLocked}
        />
      )}

      <header className="mb-1 flex items-baseline justify-between border-b border-hair pb-1">
        <h2 className="text-[14px] font-semibold text-ink">Debt</h2>
        <span className="text-[12px] text-ink-3">{fmtUsd(total)}</span>
      </header>
      <ul className="divide-y divide-hair">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
            <div
              className="min-w-0 flex-1 cursor-pointer"
              onClick={() => {
                announceDetailOpen("debts");
                setDetailRow(r);
              }}
            >
              <div className="font-medium text-ink">
                {r.name}
                {r.isPlaidLinked && (
                  <span className="ml-2 inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                    Plaid
                  </span>
                )}
              </div>
              <div className="text-[12px] text-ink-3">
                {r.liabilityType ? TYPE_LABEL[r.liabilityType] ?? "Loan" : "Loan"}
                {r.isPlaidLinked && r.aprPercentage != null && (
                  <span> · {r.aprPercentage.toFixed(2)}% APR</span>
                )}
                {r.isPlaidLinked && r.minimumPayment != null && (
                  <span> · Min {fmtUsd(r.minimumPayment)}</span>
                )}
                {ownerLabels(r) && <span> · {ownerLabels(r)}</span>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="tabular-nums text-ink">{fmtUsd(r.balance)}</span>
              {editEnabled && (
                <>
                  <button
                    type="button"
                    onClick={() => openEdit(r)}
                    disabled={inFlight}
                    className="rounded-md border border-hair px-2 py-1 text-[12px] text-ink-2 hover:bg-card disabled:opacity-50"
                  >
                    Edit
                  </button>
                  {/* Delete stays manual-only — unlink the institution first. */}
                  {!r.isPlaidLinked && (
                    <button
                      type="button"
                      onClick={() => remove(r)}
                      disabled={inFlight}
                      className="rounded-md border border-hair px-2 py-1 text-[12px] text-ink-2 hover:bg-card disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      {detailRow && (
        <PortalDetailPortal closeLabel="Close debt details" onClose={closeDetail}>
          <DebtDetailPanel
            debt={{
              id: detailRow.id,
              name: detailRow.name,
              balance: detailRow.balance,
              typeLabel: detailRow.liabilityType
                ? TYPE_LABEL[detailRow.liabilityType] ?? "Loan"
                : "Loan",
              aprPercentage: detailRow.aprPercentage,
              statementBalance: detailRow.statementBalance,
              minimumPayment: detailRow.minimumPayment,
              nextPaymentDueDate: detailRow.nextPaymentDueDate,
              isPlaidLinked: detailRow.isPlaidLinked,
              ownerLabel: ownerLabels(detailRow),
            }}
            onClose={closeDetail}
          />
        </PortalDetailPortal>
      )}
    </section>
  );
}
