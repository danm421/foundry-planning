"use client";

import type { ReactElement } from "react";
import { fmtUsd } from "@/lib/portal/format";
import { CurrencyInput } from "@/components/portal/currency-input";
import type { PortalDebtRow } from "@/lib/portal/contracts";
import { TYPE_LABEL, TYPE_ORDER } from "@/lib/portal/account-rail";

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

export type DebtFormState = {
  name: string;
  liabilityType: string;
  balance: string;
  ownerFmIds: Set<string>;
  ownerEntityIds: Set<string>;
};

export function debtRowToForm(row: PortalDebtRow): DebtFormState {
  return {
    name: row.name,
    liabilityType: row.liabilityType ?? "other",
    balance: String(row.rawBalance),
    ownerFmIds: new Set(row.ownerFmIds),
    ownerEntityIds: new Set(row.ownerEntityIds),
  };
}

export function debtOwnersFromForm(
  form: DebtFormState,
): Array<{ kind: "family_member" | "entity"; familyMemberId?: string; entityId?: string; percent: number }> {
  const ids = [
    ...Array.from(form.ownerFmIds).map((id) => ({ kind: "family_member" as const, familyMemberId: id })),
    ...Array.from(form.ownerEntityIds).map((id) => ({ kind: "entity" as const, entityId: id })),
  ];
  if (ids.length === 0) return [];
  const share = 1 / ids.length;
  return ids.map((o) => ({ ...o, percent: share }));
}

export function DebtFormPanel({
  form,
  setForm,
  familyMembers,
  trustEntities,
  onCancel,
  onSubmit,
  disabled,
  plaidLocked,
}: {
  form: DebtFormState;
  setForm: (f: DebtFormState) => void;
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
