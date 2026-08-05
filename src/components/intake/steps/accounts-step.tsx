"use client";

import { useState } from "react";
import type { IntakeDraft } from "@/lib/intake/schema";
import {
  MoneyInput,
  OwnerField,
  inputCls,
  labelCls,
  ownerLabel,
  ownerOptions,
  selectCls,
} from "./card-list";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AccountsSlice = IntakeDraft["accounts"];
type AccountItem = NonNullable<AccountsSlice>[number];

export interface AccountsStepProps {
  value: AccountsSlice;
  onChange: (next: AccountsSlice) => void;
  /** Display name for the primary client (falls back to "Client"). */
  clientName?: string;
  /** Display name for the spouse (falls back to "Spouse"); omit when none. */
  spouseName?: string;
  /** When false, only the client is offered as an owner. */
  hasSpouse?: boolean;
}

// ─── Options ─────────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS = [
  { value: "taxable",       label: "Taxable brokerage" },
  { value: "cash",          label: "Cash / savings" },
  { value: "retirement",    label: "Retirement (IRA / 401k)" },
  { value: "annuity",       label: "Annuity" },
  { value: "life_insurance", label: "Life insurance (cash value)" },
] as const;

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((o) => [o.value, o.label]),
);

// Categories where tax basis drives the projection: capital gains on a taxable
// sale, the annuity exclusion ratio, and life-insurance cash-value gains. Cash
// and retirement balances don't use it, so we don't ask a client for a number
// they'd have to guess at.
const BASIS_CATEGORIES = new Set(["taxable", "annuity", "life_insurance"]);

/** "taxable" is a blank account's category, so it's the fallback everywhere. */
function asksForBasis(category: AccountItem["category"] | undefined): boolean {
  return BASIS_CATEGORIES.has(category ?? "taxable");
}


// ─── Blank template ──────────────────────────────────────────────────────────

function blankAccount(): AccountItem {
  return { name: "", category: "taxable", value: 0, owner: "client" };
}

// ─── Formatting ──────────────────────────────────────────────────────────────

function money(n: number | undefined): string {
  return `$${Math.round(n ?? 0).toLocaleString()}`;
}

// ─── KPI totals ──────────────────────────────────────────────────────────────

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-hair bg-card px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
        {label}
      </p>
      <p className="tabular mt-1 text-[20px] font-semibold text-ink">{value}</p>
    </div>
  );
}

// ─── Add button ──────────────────────────────────────────────────────────────

function AddAccountButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-4 py-2 text-[14px] font-medium text-accent-on transition-opacity hover:opacity-90"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        strokeWidth={1.75}
        stroke="currentColor"
        aria-hidden="true"
      >
        <path d="M7 2v10M2 7h10" />
      </svg>
      Add account
    </button>
  );
}

// ─── Collapsed summary row ───────────────────────────────────────────────────

function SummaryRow({
  account,
  ownerLabel,
  onEdit,
  onRemove,
}: {
  account: AccountItem;
  ownerLabel: string;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const name = account.name?.trim() || "Untitled account";
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-hair bg-card px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] text-ink">{name}</p>
        <p className="truncate text-[12px] text-ink-3">
          {CATEGORY_LABEL[account.category ?? "taxable"]} · {ownerLabel}
        </p>
      </div>
      <span className="tabular shrink-0 text-[14px] text-ink">{money(account.value)}</span>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${name}`}
        className="shrink-0 rounded-[var(--radius-sm)] border border-hair px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className="shrink-0 rounded-[var(--radius-sm)] border border-hair p-1.5 text-ink-3 transition-colors hover:border-crit hover:text-crit"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 14 14"
          fill="none"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path d="M2 2l10 10M12 2L2 12" />
        </svg>
      </button>
    </div>
  );
}

// ─── AccountsStep ─────────────────────────────────────────────────────────────
//
// One account is open for editing at a time; every other account collapses to a
// summary row (name · category · owner · value) with Edit / remove controls. So
// adding a second account folds the first one away — the form stays short no
// matter how many accounts a client lists.

export function AccountsStep({
  value,
  onChange,
  clientName,
  spouseName,
  hasSpouse = false,
}: AccountsStepProps) {
  const accounts = value ?? [];
  const ownerOpts = ownerOptions({ clientName, spouseName, hasSpouse });

  // Index of the account currently expanded for editing; null = all collapsed.
  // Adding opens the new account; revisiting the step opens nothing.
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const total = accounts.reduce((sum, a) => sum + (a.value ?? 0), 0);

  function addAccount() {
    onChange([...accounts, blankAccount()]);
    setEditingIndex(accounts.length); // open the one just appended
  }

  function removeAccount(index: number) {
    onChange(accounts.filter((_, i) => i !== index));
    setEditingIndex((cur) => {
      if (cur === null) return null;
      if (cur === index) return null;
      return cur > index ? cur - 1 : cur;
    });
  }

  function updateAccount(index: number, patch: Partial<AccountItem>) {
    onChange(accounts.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  }

  return (
    <div className="space-y-6">
      {/* ── KPI totals + Add ───────────────────────────────────────── */}
      {accounts.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Kpi label="Total value" value={money(total)} />
            <Kpi label="Accounts" value={String(accounts.length)} />
          </div>
          <div className="flex justify-end">
            <AddAccountButton onClick={addAccount} />
          </div>
        </>
      )}

      {/* ── Empty state ────────────────────────────────────────────── */}
      {accounts.length === 0 && (
        <div className="rounded-[var(--radius-sm)] border border-dashed border-hair-2 px-4 py-10 text-center">
          <p className="text-[14px] text-ink-2">No accounts added yet</p>
          <p className="mb-5 mt-1 text-[13px] text-ink-3">
            Add your brokerage, retirement, and savings accounts.
          </p>
          <AddAccountButton onClick={addAccount} />
        </div>
      )}

      {/* ── Rows: one expanded editor, the rest collapsed ──────────── */}
      {accounts.length > 0 && (
        <div className="space-y-3">
          {accounts.map((account, i) => {
            if (i !== editingIndex) {
              return (
                <SummaryRow
                  key={i}
                  account={account}
                  ownerLabel={ownerLabel(account.owner, ownerOpts)}
                  onEdit={() => setEditingIndex(i)}
                  onRemove={() => removeAccount(i)}
                />
              );
            }

            const idp = `account-${i}`;
            const showBasis = asksForBasis(account.category);
            return (
              <div
                key={i}
                className="rounded-[var(--radius-sm)] border border-hair bg-card p-4"
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* Name */}
                  <div className="sm:col-span-2">
                    <label htmlFor={`${idp}-name`} className={labelCls}>
                      Account name
                    </label>
                    <input
                      id={`${idp}-name`}
                      type="text"
                      className={inputCls}
                      value={account.name ?? ""}
                      onChange={(e) => updateAccount(i, { name: e.target.value })}
                      placeholder="e.g. Fidelity Brokerage"
                      aria-label="Account name"
                    />
                  </div>

                  {/* Category */}
                  <div>
                    <label htmlFor={`${idp}-category`} className={labelCls}>
                      Category
                    </label>
                    <select
                      id={`${idp}-category`}
                      className={selectCls}
                      value={account.category ?? "taxable"}
                      onChange={(e) => {
                        const category = e.target.value as AccountItem["category"];
                        updateAccount(i, {
                          category,
                          // Drop a basis the new category doesn't ask for, so a
                          // hidden field can't submit a stale number.
                          ...(asksForBasis(category) ? {} : { basis: undefined }),
                        });
                      }}
                      aria-label="Category"
                    >
                      {CATEGORY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Owner */}
                  <OwnerField
                    id={`${idp}-owner`}
                    value={account.owner}
                    options={ownerOpts}
                    onChange={(owner) => updateAccount(i, { owner })}
                  />

                  {/* Value */}
                  <div>
                    <label htmlFor={`${idp}-value`} className={labelCls}>
                      Current value
                    </label>
                    <MoneyInput
                      id={`${idp}-value`}
                      value={account.value}
                      onChange={(num) => updateAccount(i, { value: num })}
                      ariaLabel="Current value"
                      placeholder="0"
                    />
                  </div>

                  {/* Tax basis — only where it affects taxes */}
                  {showBasis && (
                    <div>
                      <label htmlFor={`${idp}-basis`} className={labelCls}>
                        Tax basis
                        <span className="ml-1 font-normal normal-case text-ink-4">
                          (optional)
                        </span>
                      </label>
                      <MoneyInput
                        id={`${idp}-basis`}
                        value={account.basis}
                        onChange={(num) => updateAccount(i, { basis: num })}
                        ariaLabel="Tax basis"
                        placeholder="0"
                      />
                    </div>
                  )}

                  {/* Custodian (optional) */}
                  <div className="sm:col-span-2">
                    <label htmlFor={`${idp}-custodian`} className={labelCls}>
                      Custodian
                      <span className="ml-1 font-normal normal-case text-ink-4">
                        (optional)
                      </span>
                    </label>
                    <input
                      id={`${idp}-custodian`}
                      type="text"
                      className={inputCls}
                      value={account.custodian ?? ""}
                      onChange={(e) =>
                        updateAccount(i, {
                          custodian: e.target.value || undefined,
                        })
                      }
                      placeholder="e.g. Fidelity"
                      aria-label="Custodian"
                    />
                  </div>
                </div>

                {/* Editor controls */}
                <div className="mt-4 flex items-center justify-between border-t border-hair pt-3">
                  <button
                    type="button"
                    onClick={() => removeAccount(i)}
                    className="rounded-[var(--radius-sm)] border border-hair px-3 py-1.5 text-[12px] text-ink-3 transition-colors hover:border-crit hover:text-crit"
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingIndex(null)}
                    className="rounded-[var(--radius-sm)] border border-hair px-3 py-1.5 text-[12px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
                  >
                    Done
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
