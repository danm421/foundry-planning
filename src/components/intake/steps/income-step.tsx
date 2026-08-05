"use client";

import type { IntakeDraft } from "@/lib/intake/schema";
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

export type IncomeSlice = IntakeDraft["income"];
type IncomeItem = NonNullable<IncomeSlice>[number];

export interface IncomeStepProps {
  value: IncomeSlice;
  onChange: (next: IncomeSlice) => void;
  /** Display name for the primary client (falls back to "Client"). */
  clientName?: string;
  /** Display name for the spouse (falls back to "Spouse"); omit when none. */
  spouseName?: string;
  /** When false, only the client is offered as an owner. */
  hasSpouse?: boolean;
}

// ─── Options ─────────────────────────────────────────────────────────────────

const TYPE_OPTIONS = [
  { value: "salary",           label: "Salary / wages" },
  { value: "social_security",  label: "Social Security" },
  { value: "business",         label: "Business income" },
  { value: "other",            label: "Other" },
] as const;


// ─── Blank template ──────────────────────────────────────────────────────────

function blankIncome(): IncomeItem {
  return { name: "", type: "salary", annualAmount: 0, owner: "client" };
}

// ─── IncomeStep ───────────────────────────────────────────────────────────────
//
// One income source is open for editing at a time; every other one collapses to
// a summary row (name · type · owner · annual amount) with Edit / remove
// controls — the same shape as the Accounts step.

export function IncomeStep({
  value,
  onChange,
  clientName,
  spouseName,
  hasSpouse = false,
}: IncomeStepProps) {
  const income = value ?? [];
  const ownerOpts = ownerOptions({ clientName, spouseName, hasSpouse });

  const total = income.reduce((sum, item) => sum + (item.annualAmount ?? 0), 0);

  function addIncome() {
    onChange([...income, blankIncome()]);
  }

  function removeIncome(index: number) {
    onChange(income.filter((_, i) => i !== index));
  }

  function updateIncome(index: number, patch: Partial<IncomeItem>) {
    onChange(income.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  return (
    <CardList
      addLabel="Add income"
      emptyMessage="No income sources added yet"
      emptyHint="Add salary, Social Security, business, and any other income."
      items={income}
      kpis={[
        { label: "Total annual income", value: money(total) },
        { label: "Income sources", value: String(income.length) },
      ]}
      onAdd={addIncome}
      onRemove={removeIncome}
      renderSummary={(item) => ({
        title: item.name?.trim() || "Untitled income",
        subtitle: `${labelFor(TYPE_OPTIONS, item.type)} · ${labelFor(ownerOpts, item.owner)}`,
        amount: item.annualAmount,
      })}
      renderItem={(item, i) => {
        const idp = `income-${i}`;
        return (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Name */}
            <div className="sm:col-span-2">
              <label htmlFor={`${idp}-name`} className={labelCls}>
                Description
              </label>
              <input
                id={`${idp}-name`}
                type="text"
                className={inputCls}
                value={item.name ?? ""}
                onChange={(e) => updateIncome(i, { name: e.target.value })}
                placeholder="e.g. Salary at Acme Corp"
                aria-label="Description"
              />
            </div>

            {/* Type */}
            <div>
              <label htmlFor={`${idp}-type`} className={labelCls}>
                Type
              </label>
              <select
                id={`${idp}-type`}
                className={selectCls}
                value={item.type ?? "salary"}
                onChange={(e) =>
                  updateIncome(i, { type: e.target.value as IncomeItem["type"] })
                }
                aria-label="Type"
              >
                {TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Owner */}
            <OwnerField
              id={`${idp}-owner`}
              value={item.owner}
              options={ownerOpts}
              onChange={(owner) => updateIncome(i, { owner })}
            />

            {/* Annual amount */}
            <div className="sm:col-span-2">
              <label htmlFor={`${idp}-annualAmount`} className={labelCls}>
                Annual amount
              </label>
              <MoneyInput
                id={`${idp}-annualAmount`}
                value={item.annualAmount}
                onChange={(num) => updateIncome(i, { annualAmount: num })}
                ariaLabel="Annual amount"
                placeholder="0"
              />
            </div>
          </div>
        );
      }}
    />
  );
}
