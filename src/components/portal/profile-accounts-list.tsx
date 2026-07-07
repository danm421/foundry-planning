"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { ReactElement } from "react";
import { PLAID_LOCKED_FIELDS } from "@/lib/portal/plaid-locked-fields";
import { CurrencyInput } from "@/components/portal/currency-input";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import {
  AccountDetailPanel,
  announceDetailOpen,
  useCloseOnOtherDetail,
} from "@/components/portal/account-detail-panel";

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

const CATEGORY_LABELS: Record<string, string> = {
  cash: "Cash",
  taxable: "Taxable",
  retirement: "Retirement",
  annuity: "Annuity",
  real_estate: "Real estate",
  business: "Business",
  stock_options: "Stock options",
  life_insurance: "Life insurance",
  notes_receivable: "Notes receivable",
};

const CATEGORY_ORDER = [
  "cash",
  "taxable",
  "retirement",
  "annuity",
  "real_estate",
  "business",
  "stock_options",
  "life_insurance",
  "notes_receivable",
] as const;

const SUBTYPES_BY_CATEGORY: Record<string, string[]> = {
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

function PlaidSyncHint(): ReactElement {
  return <span className="ml-1 text-[11px]">· Synced via Plaid</span>;
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
  const [form, setForm] = useState<FormState>(() =>
    emptyForm("cash", primaryFm?.id ?? null),
  );
  // Drill-down into the shared #portal-detail rail (resolved post-commit — see
  // budget-view for why a render-phase lookup breaks in the advisor preview).
  const [detailRow, setDetailRow] = useState<AccountRow | null>(null);
  const [detailEl, setDetailEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetailEl(document.getElementById("portal-detail"));
  }, []);
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
        <FormPanel
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

      {detailRow && detailEl &&
        createPortal(
          // Desktop: inline in the side rail. Below `lg`: bottom sheet with a
          // tap-to-dismiss scrim (the transactions-list pattern).
          <div className="max-lg:fixed max-lg:inset-0 max-lg:z-40 max-lg:flex max-lg:flex-col max-lg:justify-end">
            <button
              type="button"
              aria-label="Close account details"
              onClick={closeDetail}
              className="absolute inset-0 -z-10 bg-black/50 lg:hidden"
            />
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
          </div>,
          detailEl,
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
