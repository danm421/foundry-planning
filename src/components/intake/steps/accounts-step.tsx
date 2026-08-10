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
import {
  DEFAULT_INTAKE_ACCOUNT_CATEGORY,
  INTAKE_ACCOUNT_CATEGORY_OPTIONS,
  defaultSubTypeForCategory,
  deriveIntakeAccountName,
  intakeAccountTypeLabel,
  subTypesForCategory,
} from "@/lib/intake/account-types";

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
//
// Category and sub-type both come from the shared intake taxonomy, so the form,
// the CRM note, and the advisor's review diff can't drift apart. See
// `lib/intake/account-types.ts`.

// Categories where tax basis drives the projection: capital gains on a taxable
// sale, the annuity exclusion ratio, and life-insurance cash-value gains. Cash,
// retirement, and 529 balances don't use it, so we don't ask a client for a
// number they'd have to guess at.
const BASIS_CATEGORIES = new Set(["taxable", "annuity", "life_insurance"]);

/** "taxable" is a blank account's category, so it's the fallback everywhere. */
function asksForBasis(category: AccountItem["category"] | undefined): boolean {
  return BASIS_CATEGORIES.has(category ?? DEFAULT_INTAKE_ACCOUNT_CATEGORY);
}

// ─── AccountsStep ─────────────────────────────────────────────────────────────
//
// One account is open for editing at a time; every other account collapses to a
// summary row (name · type · owner · value) with Edit / remove controls. So
// adding a second account folds the first one away — the form stays short no
// matter how many accounts a client lists.
//
// The client never names an account. Every edit re-derives the name from what
// the account IS — type · owner · custodian — so what the advisor receives is
// "Roth IRA - Dana - Fidelity", not "mine". A name that arrived on a seeded row
// (the advisor's own account name) is kept until the client edits that row.

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
  const ownerNames = { clientName, spouseName };

  const total = accounts.reduce((sum, a) => sum + (a.value ?? 0), 0);

  function addAccount() {
    const blank: AccountItem = {
      category: DEFAULT_INTAKE_ACCOUNT_CATEGORY,
      subType: defaultSubTypeForCategory(DEFAULT_INTAKE_ACCOUNT_CATEGORY),
      value: 0,
      owner: "client",
    };
    onChange([...accounts, { ...blank, name: deriveIntakeAccountName(blank, ownerNames) }]);
  }

  function removeAccount(index: number) {
    onChange(accounts.filter((_, i) => i !== index));
  }

  // The single write path — so the derived name can't fall out of step with the
  // fields it's built from, whichever field was edited.
  function updateAccount(index: number, patch: Partial<AccountItem>) {
    onChange(
      accounts.map((a, i) => {
        if (i !== index) return a;
        const next = { ...a, ...patch };
        return { ...next, name: deriveIntakeAccountName(next, ownerNames) };
      }),
    );
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
          title:
            account.name?.trim() || deriveIntakeAccountName(account, ownerNames),
          subtitle: `${intakeAccountTypeLabel(account)} · ${labelFor(ownerOpts, account.owner)}`,
          amount: account.value,
        })}
        renderItem={(account, i) => {
          const idp = `account-${i}`;
          const showBasis = asksForBasis(account.category);
          const subTypes = subTypesForCategory(account.category);
          return (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Category */}
              <div>
                <label htmlFor={`${idp}-category`} className={labelCls}>
                  Category
                </label>
                <select
                  id={`${idp}-category`}
                  className={selectCls}
                  value={account.category ?? DEFAULT_INTAKE_ACCOUNT_CATEGORY}
                  onChange={(e) => {
                    const category = e.target.value as AccountItem["category"];
                    updateAccount(i, {
                      category,
                      // The old sub-type belongs to the old category — re-seed
                      // with the new one's default rather than carrying over a
                      // pairing the submit schema would reject.
                      subType: defaultSubTypeForCategory(category),
                      // Drop a basis the new category doesn't ask for, so a
                      // hidden field can't submit a stale number.
                      ...(asksForBasis(category) ? {} : { basis: undefined }),
                    });
                  }}
                  aria-label="Category"
                >
                  {INTAKE_ACCOUNT_CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Type — hidden where the category has nothing to split into
                  (annuity) or exactly one (529), which is assigned silently. */}
              {subTypes.length > 1 && (
                <div>
                  <label htmlFor={`${idp}-subtype`} className={labelCls}>
                    Type
                  </label>
                  <select
                    id={`${idp}-subtype`}
                    className={selectCls}
                    value={account.subType ?? subTypes[0].value}
                    onChange={(e) =>
                      updateAccount(i, {
                        subType: e.target.value as AccountItem["subType"],
                      })
                    }
                    aria-label="Type"
                  >
                    {subTypes.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

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
              <div>
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

              {/* The name this account will be saved under — there is no name
                  field, so show what the answers above add up to. */}
              <div className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 sm:col-span-2">
                <p className={labelCls}>Saved as</p>
                <p className="truncate text-[14px] text-ink">
                  {deriveIntakeAccountName(account, ownerNames)}
                </p>
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
