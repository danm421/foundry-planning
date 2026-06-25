"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReactElement } from "react";
import { fmtUsd } from "@/lib/portal/format";
import { LIABILITY_PLAID_LOCKED_FIELDS } from "@/lib/portal/plaid-locked-fields";
import { CurrencyInput } from "@/components/portal/currency-input";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import type { PortalDebtRow } from "@/lib/portal/portal-networth";

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

const TYPE_LABEL: Record<string, string> = {
  mortgage: "Mortgage", heloc: "HELOC", auto: "Auto loan", student: "Student loan",
  personal: "Personal loan", credit_card: "Credit card", other: "Loan",
};

const TYPE_ORDER = [
  "mortgage", "heloc", "auto", "student", "personal", "credit_card", "other",
] as const;

type FormState = {
  name: string;
  liabilityType: string;
  balance: string;
  ownerFmIds: Set<string>;
  ownerEntityIds: Set<string>;
};

function rowToForm(row: PortalDebtRow): FormState {
  return {
    name: row.name,
    liabilityType: row.liabilityType ?? "other",
    balance: String(row.rawBalance),
    ownerFmIds: new Set(row.ownerFmIds),
    ownerEntityIds: new Set(row.ownerEntityIds),
  };
}

function ownersFromForm(
  form: FormState,
): Array<{ kind: "family_member" | "entity"; familyMemberId?: string; entityId?: string; percent: number }> {
  const ids = [
    ...Array.from(form.ownerFmIds).map((id) => ({ kind: "family_member" as const, familyMemberId: id })),
    ...Array.from(form.ownerEntityIds).map((id) => ({ kind: "entity" as const, entityId: id })),
  ];
  if (ids.length === 0) return [];
  const share = 1 / ids.length;
  return ids.map((o) => ({ ...o, percent: share }));
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
  const [form, setForm] = useState<FormState | null>(null);

  if (rows.length === 0) return null;

  const total = rows.reduce((s, r) => s + r.balance, 0);
  const inFlight = busy || isPending;
  const openRow = openId ? rows.find((r) => r.id === openId) ?? null : null;
  // A Plaid-linked debt's balance is synced — lock it (the PUT route also rejects it).
  const plaidLocked = openRow?.isPlaidLinked ?? false;

  function openEdit(row: PortalDebtRow) {
    setForm(rowToForm(row));
    setOpenId(row.id);
  }
  function cancel() {
    setOpenId(null);
    setForm(null);
  }

  async function submit() {
    if (!form || !openId) return;
    const owners = ownersFromForm(form);
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
            <div className="min-w-0">
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
    </section>
  );
}

function DebtFormPanel({
  form,
  setForm,
  familyMembers,
  trustEntities,
  onCancel,
  onSubmit,
  disabled,
  plaidLocked,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  familyMembers: FamilyMember[];
  trustEntities: TrustEntity[];
  onCancel: () => void;
  onSubmit: () => void;
  disabled: boolean;
  plaidLocked: boolean;
}): ReactElement {
  const eligibleOwners = familyMembers.filter((m) => m.role === "client" || m.role === "spouse");

  function toggleFm(id: string) {
    const next = new Set(form.ownerFmIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setForm({ ...form, ownerFmIds: next });
  }
  function toggleEnt(id: string) {
    const next = new Set(form.ownerEntityIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setForm({ ...form, ownerEntityIds: next });
  }

  return (
    <div className="space-y-3 rounded-md border border-hair bg-card-2 p-4 text-[13px]">
      {plaidLocked && (
        <p className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-[12px] text-ink-2">
          The balance syncs from your institution and can&apos;t be edited here.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-ink-3">Name</span>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded-md border border-hair bg-paper px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-ink-3">Type</span>
          <select
            value={form.liabilityType}
            onChange={(e) => setForm({ ...form, liabilityType: e.target.value })}
            className="rounded-md border border-hair bg-paper px-2 py-1"
          >
            {TYPE_ORDER.map((t) => (
              <option key={t} value={t}>{TYPE_LABEL[t]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-ink-3">Balance</span>
          {plaidLocked ? (
            <span className="rounded-md border border-hair bg-card px-2 py-1 tabular-nums text-ink-3">
              {fmtUsd(Number(form.balance))}
              <span className="ml-1 text-[11px]">· Synced via Plaid</span>
            </span>
          ) : (
            <CurrencyInput
              aria-label="Balance"
              value={form.balance}
              onValueChange={(v) => setForm({ ...form, balance: v })}
              className="rounded-md border border-hair bg-paper px-2 py-1"
            />
          )}
        </label>
      </div>

      <fieldset className="space-y-1">
        <legend className="text-[12px] text-ink-3">Owners</legend>
        {eligibleOwners.length === 0 && trustEntities.length === 0 && (
          <p className="text-[12px] text-ink-3">No owner candidates — ask your advisor to set up your household.</p>
        )}
        {eligibleOwners.map((m) => (
          <label key={m.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.ownerFmIds.has(m.id)}
              onChange={() => toggleFm(m.id)}
            />
            {m.firstName}{m.lastName ? " " + m.lastName : ""}{" "}
            <span className="text-[12px] text-ink-3">({m.role})</span>
          </label>
        ))}
        {trustEntities.map((t) => (
          <label key={t.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.ownerEntityIds.has(t.id)}
              onChange={() => toggleEnt(t.id)}
            />
            {t.name} <span className="text-[12px] text-ink-3">(trust)</span>
          </label>
        ))}
      </fieldset>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="rounded-md border border-hair px-3 py-1.5 text-[13px] text-ink-2 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          className="rounded-md border border-accent bg-accent/15 px-3 py-1.5 text-[13px] font-medium text-accent disabled:opacity-50"
        >
          {disabled ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
