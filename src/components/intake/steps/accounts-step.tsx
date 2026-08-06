"use client";

import type { IntakeDraft } from "@/lib/intake/schema";
import {
  ContextualUploadZone,
  type IntakeUploadContext,
} from "@/components/intake/intake-upload-zone";
import {
  CardList,
  MoneyInput,
  OwnerField,
  inputCls,
  labelCls,
  labelFor,
  money,
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
  /** Present only on the public wizard; omit and no upload zone renders. */
  uploads?: IntakeUploadContext;
}

// ─── Options ─────────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS = [
  { value: "taxable",       label: "Taxable brokerage" },
  { value: "cash",          label: "Cash / savings" },
  { value: "retirement",    label: "Retirement (IRA / 401k)" },
  { value: "annuity",       label: "Annuity" },
  { value: "life_insurance", label: "Life insurance (cash value)" },
] as const;

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
  uploads,
}: AccountsStepProps) {
  const accounts = value ?? [];
  const ownerOpts = ownerOptions({ clientName, spouseName, hasSpouse });

  const total = accounts.reduce((sum, a) => sum + (a.value ?? 0), 0);

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
    <div className="space-y-6">
      <CardList
        addLabel="Add account"
        emptyMessage="No accounts added yet"
        emptyHint="Add your brokerage, retirement, and savings accounts."
        items={accounts}
        kpis={[
          { label: "Total value", value: money(total) },
          { label: "Accounts", value: String(accounts.length) },
        ]}
        onAdd={addAccount}
        onRemove={removeAccount}
        renderSummary={(account) => ({
          title: account.name?.trim() || "Untitled account",
          subtitle: `${labelFor(CATEGORY_OPTIONS, account.category)} · ${labelFor(ownerOpts, account.owner)}`,
          amount: account.value,
        })}
        renderItem={(account, i) => {
          const idp = `account-${i}`;
          const showBasis = asksForBasis(account.category);
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
          );
        }}
      />

      <ContextualUploadZone
        uploads={uploads}
        docType="statement"
        label="Or upload your statements"
      />
    </div>
  );
}
