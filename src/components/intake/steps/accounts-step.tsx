"use client";

import type { IntakeDraft } from "@/lib/intake/schema";
import { CardList, inputCls, labelCls, selectCls } from "./card-list";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AccountsSlice = IntakeDraft["accounts"];
type AccountItem = NonNullable<AccountsSlice>[number];

export interface AccountsStepProps {
  value: AccountsSlice;
  onChange: (next: AccountsSlice) => void;
}

// ─── Options ─────────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS = [
  { value: "taxable",       label: "Taxable brokerage" },
  { value: "cash",          label: "Cash / savings" },
  { value: "retirement",    label: "Retirement (IRA / 401k)" },
  { value: "annuity",       label: "Annuity" },
  { value: "life_insurance", label: "Life insurance (cash value)" },
] as const;

// ─── Blank template ──────────────────────────────────────────────────────────

function blankAccount(): AccountItem {
  return { name: "", category: "taxable", value: 0 };
}

// ─── AccountsStep ─────────────────────────────────────────────────────────────

export function AccountsStep({ value, onChange }: AccountsStepProps) {
  const accounts = value ?? [];

  function addAccount() {
    onChange([...accounts, blankAccount()]);
  }

  function removeAccount(index: number) {
    onChange(accounts.filter((_, i) => i !== index));
  }

  function updateAccount(index: number, patch: Partial<AccountItem>) {
    onChange(accounts.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  }

  return (
    <CardList
      heading="Accounts"
      addLabel="Add account"
      emptyMessage="No accounts added yet."
      items={accounts}
      onAdd={addAccount}
      onRemove={removeAccount}
      renderItem={(account, i) => {
        const idp = `account-${i}`;
        return (
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
                onChange={(e) =>
                  updateAccount(i, {
                    category: e.target.value as AccountItem["category"],
                  })
                }
                aria-label="Category"
              >
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Value */}
            <div>
              <label htmlFor={`${idp}-value`} className={labelCls}>
                Current value ($)
              </label>
              <input
                id={`${idp}-value`}
                type="number"
                min={0}
                className={`${inputCls} tabular`}
                value={account.value ?? 0}
                onChange={(e) =>
                  updateAccount(i, {
                    value: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
                aria-label="Current value"
              />
            </div>

            {/* Custodian (optional) */}
            <div className="sm:col-span-2">
              <label htmlFor={`${idp}-custodian`} className={labelCls}>
                Custodian
                <span className="ml-1 font-normal normal-case text-ink-4">(optional)</span>
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
        );
      }}
    />
  );
}
