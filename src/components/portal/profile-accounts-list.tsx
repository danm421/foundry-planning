"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReactElement } from "react";

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

const CATEGORY_LABELS: Record<string, string> = {
  cash: "Cash",
  taxable: "Taxable",
  retirement: "Retirement",
  real_estate: "Real estate",
  business: "Business",
  life_insurance: "Life insurance",
  notes_receivable: "Notes receivable",
};

const CATEGORY_ORDER = [
  "cash",
  "taxable",
  "retirement",
  "real_estate",
  "business",
  "life_insurance",
  "notes_receivable",
] as const;

const SUBTYPES_BY_CATEGORY: Record<string, string[]> = {
  cash: ["checking", "savings", "other"],
  taxable: ["brokerage", "other"],
  retirement: ["traditional_ira", "roth_ira", "401k", "403b", "529", "other"],
  real_estate: ["primary_residence", "rental_property", "commercial_property", "other"],
  business: ["sole_proprietorship", "partnership", "s_corp", "c_corp", "llc", "other"],
  life_insurance: ["term", "whole_life", "universal_life", "variable_life", "other"],
  notes_receivable: ["other"],
};

type FormState = {
  name: string;
  last4: string;
  category: string;
  subType: string;
  value: string;
  ownerFmIds: Set<string>;
  ownerEntityIds: Set<string>;
};

function emptyForm(category = "cash", defaultFm: string | null = null): FormState {
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

function rowToForm(row: AccountRow): FormState {
  return {
    name: row.name,
    last4: row.accountNumberLast4 ?? "",
    category: row.category,
    subType: row.subType,
    value: row.value,
    ownerFmIds: new Set(row.owners.filter((o) => o.familyMemberId).map((o) => o.familyMemberId!)),
    ownerEntityIds: new Set(row.owners.filter((o) => o.entityId).map((o) => o.entityId!)),
  };
}

function ownersFromForm(form: FormState): Array<{ kind: "family_member" | "entity"; familyMemberId?: string; entityId?: string; percent: number }> {
  const ids = [
    ...Array.from(form.ownerFmIds).map((id) => ({ kind: "family_member" as const, familyMemberId: id })),
    ...Array.from(form.ownerEntityIds).map((id) => ({ kind: "entity" as const, entityId: id })),
  ];
  if (ids.length === 0) return [];
  const share = 1 / ids.length;
  return ids.map((o) => ({ ...o, percent: share }));
}

function formatCurrency(n: string): string {
  const num = Number(n);
  if (!isFinite(num)) return n;
  return num.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function ProfileAccountsList({
  rows,
  familyMembers,
  trustEntities,
  editEnabled,
}: Props): ReactElement {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [openForm, setOpenForm] = useState<"new" | string | null>(null);
  const primaryFm = familyMembers.find((m) => m.role === "client") ?? null;
  const [form, setForm] = useState<FormState>(() =>
    emptyForm("cash", primaryFm?.id ?? null),
  );

  function openNew() {
    setForm(emptyForm("cash", primaryFm?.id ?? null));
    setOpenForm("new");
  }

  function openEdit(row: AccountRow) {
    setForm(rowToForm(row));
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
    const body = {
      name: form.name,
      last4: form.last4 || null,
      category: form.category,
      subType: form.subType,
      value: form.value,
      owners,
    };
    const isNew = openForm === "new";
    const res = await fetch(
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
  }

  async function remove(row: AccountRow) {
    if (!window.confirm(`Delete "${row.name}"?`)) return;
    const res = await fetch(`/api/portal/accounts/${row.id}`, { method: "DELETE" });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      alert(detail.error ?? "Delete failed");
      return;
    }
    startTransition(() => router.refresh());
  }

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
          className="rounded-md border border-accent bg-accent/15 px-3 py-1.5 text-[13px] font-medium text-accent"
        >
          + Add account
        </button>
      )}

      {editEnabled && openForm !== null && (
        <FormPanel
          form={form}
          setForm={setForm}
          familyMembers={familyMembers}
          trustEntities={trustEntities}
          onCancel={cancel}
          onSubmit={submit}
          disabled={isPending}
        />
      )}

      {CATEGORY_ORDER.filter((c) => grouped.has(c)).map((cat) => {
        const list = grouped.get(cat)!;
        const subtotal = list.reduce((s, r) => s + Number(r.value || "0"), 0);
        return (
          <section key={cat}>
            <header className="mb-1 flex items-baseline justify-between border-b border-hair pb-1">
              <h2 className="text-[14px] font-semibold text-ink">{CATEGORY_LABELS[cat] ?? cat}</h2>
              <span className="text-[12px] text-ink-3">{formatCurrency(String(subtotal))}</span>
            </header>
            <ul className="divide-y divide-hair">
              {list.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                  <div className="min-w-0">
                    <div className="font-medium text-ink">
                      {row.name}
                      {row.accountNumberLast4 ? (
                        <span className="ml-1 text-[12px] text-ink-3">·· {row.accountNumberLast4}</span>
                      ) : null}
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
                          className="rounded-md border border-hair px-2 py-1 text-[12px] text-ink-2 hover:bg-card"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(row)}
                          className="rounded-md border border-hair px-2 py-1 text-[12px] text-ink-2 hover:bg-card"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {rows.length === 0 && (
        <p className="text-[13px] text-ink-3">No accounts yet.</p>
      )}
    </div>
  );
}

function FormPanel({
  form,
  setForm,
  familyMembers,
  trustEntities,
  onCancel,
  onSubmit,
  disabled,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  familyMembers: FamilyMember[];
  trustEntities: TrustEntity[];
  onCancel: () => void;
  onSubmit: () => void;
  disabled: boolean;
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
          <span className="text-[12px] text-ink-3">Last 4 (optional)</span>
          <input
            type="text"
            value={form.last4}
            maxLength={4}
            onChange={(e) => setForm({ ...form, last4: e.target.value })}
            className="rounded-md border border-hair bg-paper px-2 py-1"
          />
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
            {CATEGORY_ORDER.map((c) => (
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
          <input
            type="number"
            step="0.01"
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
            className="rounded-md border border-hair bg-paper px-2 py-1"
          />
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
          className="rounded-md border border-hair px-3 py-1.5 text-[13px] text-ink-2"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          className="rounded-md border border-accent bg-accent/15 px-3 py-1.5 text-[13px] font-medium text-accent"
        >
          Save
        </button>
      </div>
    </div>
  );
}
