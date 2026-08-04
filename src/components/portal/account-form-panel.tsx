"use client";

import type { ReactElement } from "react";
import { CurrencyInput } from "@/components/portal/currency-input";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/lib/portal/account-rail";
import { PORTAL_VISIBLE_CATEGORIES } from "@/lib/portal/account-visibility";

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

export const SUBTYPES_BY_CATEGORY: Record<string, string[]> = {
  cash: ["checking", "savings", "other"],
  taxable: ["brokerage", "other"],
  retirement: ["traditional_ira", "roth_ira", "401k", "403b", "529", "other"],
  annuity: ["other"],
  real_estate: ["primary_residence", "rental_property", "commercial_property", "other"],
  business: ["sole_proprietorship", "partnership", "s_corp", "c_corp", "llc", "other"],
  stock_options: ["other"],
  life_insurance: ["term", "whole_life", "universal_life", "variable_life", "other"],
  notes_receivable: ["other"],
};

export type AccountFormState = {
  name: string;
  last4: string;
  category: string;
  subType: string;
  value: string;
  ownerFmIds: Set<string>;
  ownerEntityIds: Set<string>;
};

export function emptyAccountForm(category = "cash", defaultFm: string | null = null): AccountFormState {
  return {
    name: "",
    last4: "",
    category,
    subType: SUBTYPES_BY_CATEGORY[category]?.[0] ?? "other",
    value: "0",
    ownerFmIds: new Set(defaultFm ? [defaultFm] : []),
    ownerEntityIds: new Set(),
  };
}

export function accountRowToForm(
  row: { name: string; last4: string | null; category: string; subType: string; value: number },
  owners: { familyMemberId: string | null; entityId: string | null }[],
): AccountFormState {
  return {
    name: row.name,
    last4: row.last4 ?? "",
    category: row.category,
    subType: row.subType,
    value: String(row.value),
    ownerFmIds: new Set(owners.filter((o) => o.familyMemberId).map((o) => o.familyMemberId!)),
    ownerEntityIds: new Set(owners.filter((o) => o.entityId).map((o) => o.entityId!)),
  };
}

export function ownersFromForm(form: AccountFormState): Array<{ kind: "family_member" | "entity"; familyMemberId?: string; entityId?: string; percent: number }> {
  const ids = [
    ...Array.from(form.ownerFmIds).map((id) => ({ kind: "family_member" as const, familyMemberId: id })),
    ...Array.from(form.ownerEntityIds).map((id) => ({ kind: "entity" as const, entityId: id })),
  ];
  if (ids.length === 0) return [];
  const share = 1 / ids.length;
  return ids.map((o) => ({ ...o, percent: share }));
}

export function formatCurrency(n: string): string {
  const num = Number(n);
  if (!isFinite(num)) return n;
  return num.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function PlaidSyncHint(): ReactElement {
  return <span className="ml-1 text-[11px]">· Synced via Plaid</span>;
}

export function AccountFormPanel({
  form,
  setForm,
  familyMembers,
  trustEntities,
  onCancel,
  onSubmit,
  disabled,
  plaidLocked,
}: {
  form: AccountFormState;
  setForm: (f: AccountFormState) => void;
  familyMembers: FamilyMember[];
  trustEntities: TrustEntity[];
  onCancel: () => void;
  onSubmit: () => void;
  disabled: boolean;
  plaidLocked: boolean;
}): ReactElement {
  const subTypes = SUBTYPES_BY_CATEGORY[form.category] ?? ["other"];
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
          Balance and account number sync from your institution and can&apos;t be edited here.
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
          <span className="text-[12px] text-ink-3">Last 4{plaidLocked ? "" : " (optional)"}</span>
          {plaidLocked ? (
            <span className="rounded-md border border-hair bg-card px-2 py-1 text-ink-3">
              {form.last4 || "—"}
              <PlaidSyncHint />
            </span>
          ) : (
            <input
              type="text"
              value={form.last4}
              maxLength={4}
              onChange={(e) => setForm({ ...form, last4: e.target.value })}
              className="rounded-md border border-hair bg-paper px-2 py-1"
            />
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-ink-3">Category</span>
          <select
            value={form.category}
            onChange={(e) => {
              const c = e.target.value;
              setForm({ ...form, category: c, subType: SUBTYPES_BY_CATEGORY[c]?.[0] ?? "other" });
            }}
            className="rounded-md border border-hair bg-paper px-2 py-1"
          >
            {/* Only the categories POST /api/portal/accounts accepts — offering the
                rest earns a 400 "This account type can't be added from the portal". */}
            {CATEGORY_ORDER.filter((c) =>
              (PORTAL_VISIBLE_CATEGORIES as readonly string[]).includes(c),
            ).map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-ink-3">Sub-type</span>
          <select
            value={form.subType}
            onChange={(e) => setForm({ ...form, subType: e.target.value })}
            className="rounded-md border border-hair bg-paper px-2 py-1"
          >
            {subTypes.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-ink-3">Value</span>
          {plaidLocked ? (
            <span className="rounded-md border border-hair bg-card px-2 py-1 tabular-nums text-ink-3">
              {formatCurrency(form.value)}
              <PlaidSyncHint />
            </span>
          ) : (
            <CurrencyInput
              aria-label="Value"
              value={form.value}
              onValueChange={(v) => setForm({ ...form, value: v })}
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
