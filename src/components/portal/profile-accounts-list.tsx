"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReactElement } from "react";
import { PLAID_LOCKED_FIELDS } from "@/lib/portal/plaid-locked-fields";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/lib/portal/account-rail";
import {
  AccountFormPanel,
  accountRowToForm,
  emptyAccountForm,
  formatCurrency,
  ownersFromForm,
  type AccountFormState,
} from "@/components/portal/account-form-panel";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import { AccountDetailPanel } from "@/components/portal/account-detail-panel";
import {
  PortalDetailPortal,
  announceDetailOpen,
  useCloseOnOtherDetail,
} from "@/components/portal/portal-detail-rail";

interface Owner {
  familyMemberId: string | null;
  entityId: string | null;
  percent: string;
}

interface AccountRow {
  id: string;
  name: string;
  category: string;
  subType: string;
  value: string;
  accountNumberLast4: string | null;
  plaidItemId: string | null;
  owners: Owner[];
}

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
  rows: AccountRow[];
  familyMembers: FamilyMember[];
  trustEntities: TrustEntity[];
  editEnabled: boolean;
}

export default function ProfileAccountsList({
  rows,
  familyMembers,
  trustEntities,
  editEnabled,
}: Props): ReactElement {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const portalFetch = usePortalFetch();
  // True while a save/delete fetch is in flight. `isPending` only covers the
  // post-success router.refresh(), so on its own it leaves the network round-trip
  // unguarded. `inFlight` (busy || isPending) locks every mutating control end to
  // end so a second click can't double-submit or fire a delete mid-save.
  const [busy, setBusy] = useState(false);
  const [openForm, setOpenForm] = useState<"new" | string | null>(null);
  const primaryFm = familyMembers.find((m) => m.role === "client") ?? null;
  const [form, setForm] = useState<AccountFormState>(() =>
    emptyAccountForm("cash", primaryFm?.id ?? null),
  );
  // Drill-down into the shared #portal-detail rail.
  const [detailRow, setDetailRow] = useState<AccountRow | null>(null);
  const closeDetail = useCallback(() => setDetailRow(null), []);
  useCloseOnOtherDetail("accounts", closeDetail);
  function openDetail(row: AccountRow): void {
    announceDetailOpen("accounts");
    setDetailRow(row);
  }

  // True when the row open for edit is Plaid-linked, so we lock the fields the
  // PUT route rejects (the PLAID_LOCKED_FIELDS set — value/last4 in the form).
  const plaidLocked =
    typeof openForm === "string" && openForm !== "new"
      ? rows.find((r) => r.id === openForm)?.plaidItemId != null
      : false;

  function openNew() {
    setForm(emptyAccountForm("cash", primaryFm?.id ?? null));
    setOpenForm("new");
  }

  function openEdit(row: AccountRow) {
    setForm(
      accountRowToForm(
        { ...row, last4: row.accountNumberLast4, value: Number(row.value) },
        row.owners,
      ),
    );
    setOpenForm(row.id);
  }

  function cancel() {
    setOpenForm(null);
  }

  async function submit() {
    const owners = ownersFromForm(form);
    if (owners.length === 0) {
      alert("Pick at least one owner.");
      return;
    }
    const body: Record<string, unknown> = {
      name: form.name,
      category: form.category,
      subType: form.subType,
      value: form.value,
      last4: form.last4 || null,
      owners,
    };
    // Plaid owns these fields on linked accounts — sending them would 400.
    // PLAID_LOCKED_FIELDS is the same set the PUT route guards against.
    if (plaidLocked) {
      for (const k of PLAID_LOCKED_FIELDS) delete body[k];
    }
    const isNew = openForm === "new";
    setBusy(true);
    try {
      const res = await portalFetch(
        isNew ? "/api/portal/accounts" : `/api/portal/accounts/${openForm}`,
        {
          method: isNew ? "POST" : "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        alert(detail.error ?? "Save failed");
        return;
      }
      setOpenForm(null);
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: AccountRow) {
    if (!window.confirm(`Delete "${row.name}"?`)) return;
    setBusy(true);
    try {
      const res = await portalFetch(`/api/portal/accounts/${row.id}`, { method: "DELETE" });
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

  const inFlight = busy || isPending;

  function ownerLabels(row: AccountRow): string {
    const parts: string[] = [];
    for (const o of row.owners) {
      if (o.familyMemberId) {
        const fm = familyMembers.find((m) => m.id === o.familyMemberId);
        if (fm) parts.push(`${fm.firstName}${fm.lastName ? " " + fm.lastName : ""}`);
      }
      if (o.entityId) {
        const ent = trustEntities.find((t) => t.id === o.entityId);
        if (ent) parts.push(ent.name);
      }
    }
    return parts.join(" + ");
  }

  const grouped = new Map<string, AccountRow[]>();
  for (const r of rows) {
    const list = grouped.get(r.category) ?? [];
    list.push(r);
    grouped.set(r.category, list);
  }

  return (
    <div className="space-y-5">
      {editEnabled && openForm === null && (
        <button
          type="button"
          onClick={openNew}
          disabled={inFlight}
          className="rounded-md border border-accent bg-accent/15 px-3 py-1.5 text-[13px] font-medium text-accent disabled:opacity-50"
        >
          + Add account
        </button>
      )}

      {editEnabled && openForm !== null && (
        <AccountFormPanel
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

      {[
        ...CATEGORY_ORDER.filter((c) => grouped.has(c)),
        ...[...grouped.keys()].filter((c) => !(CATEGORY_ORDER as readonly string[]).includes(c)),
      ].map((cat) => {
        const list = grouped.get(cat)!;
        const subtotal = list.reduce((s, r) => s + Number(r.value || "0"), 0);
        return (
          <section key={cat}>
            <header className="mb-1 flex items-baseline justify-between border-b border-hair pb-1">
              <h2 className="text-[14px] font-semibold text-ink">{CATEGORY_LABELS[cat] ?? cat}</h2>
              <span className="text-[12px] text-ink-3">{formatCurrency(String(subtotal))}</span>
            </header>
            <ul className="divide-y divide-hair">
              {list.map((row) => {
                const isPlaid = row.plaidItemId != null;
                return (
                  <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                    <div
                      className="min-w-0 flex-1 cursor-pointer"
                      onClick={() => openDetail(row)}
                    >
                      <div className="font-medium text-ink">
                        {row.name}
                        {row.accountNumberLast4 ? (
                          <span className="ml-1 text-[12px] text-ink-3">·· {row.accountNumberLast4}</span>
                        ) : null}
                        {isPlaid && (
                          <span className="ml-2 inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                            Plaid
                          </span>
                        )}
                      </div>
                      <div className="text-[12px] text-ink-3">{ownerLabels(row) || "—"}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="tabular-nums text-ink">{formatCurrency(row.value)}</span>
                      {editEnabled && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEdit(row)}
                            disabled={inFlight}
                            className="rounded-md border border-hair px-2 py-1 text-[12px] text-ink-2 hover:bg-card disabled:opacity-50"
                          >
                            Edit
                          </button>
                          {/* Delete stays manual-only — unlink the institution first. */}
                          {!isPlaid && (
                            <button
                              type="button"
                              onClick={() => remove(row)}
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
                );
              })}
            </ul>
          </section>
        );
      })}

      {rows.length === 0 && (
        <p className="text-[13px] text-ink-3">No accounts yet.</p>
      )}

      {detailRow && (
        <PortalDetailPortal closeLabel="Close account details" onClose={closeDetail}>
          <AccountDetailPanel
            account={{
              id: detailRow.id,
              name: detailRow.name,
              value: Number(detailRow.value || "0"),
              categoryLabel: CATEGORY_LABELS[detailRow.category] ?? detailRow.category,
              subTypeLabel: detailRow.subType.replace(/_/g, " "),
              last4: detailRow.accountNumberLast4,
              isPlaid: detailRow.plaidItemId != null,
              ownerLabel: ownerLabels(detailRow),
            }}
            onClose={closeDetail}
          />
        </PortalDetailPortal>
      )}
    </div>
  );
}
