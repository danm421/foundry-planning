"use client";

import type { IntakeDraft } from "@/lib/intake/schema";
import { CardList, MoneyInput, inputCls, labelCls, selectCls } from "./card-list";

// ─── Types ───────────────────────────────────────────────────────────────────

export type IncomeSlice = IntakeDraft["income"];
type IncomeItem = NonNullable<IncomeSlice>[number];
type Owner = NonNullable<IncomeItem["owner"]>;

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

function ownerOptions(
  clientName: string | undefined,
  spouseName: string | undefined,
  hasSpouse: boolean,
): { value: Owner; label: string }[] {
  const opts: { value: Owner; label: string }[] = [
    { value: "client", label: clientName?.trim() || "Client" },
  ];
  if (hasSpouse) {
    opts.push({ value: "spouse", label: spouseName?.trim() || "Spouse" });
    opts.push({ value: "joint", label: "Joint" });
  }
  return opts;
}

// ─── Blank template ──────────────────────────────────────────────────────────

function blankIncome(): IncomeItem {
  return { name: "", type: "salary", annualAmount: 0, owner: "client" };
}

// ─── IncomeStep ───────────────────────────────────────────────────────────────

export function IncomeStep({
  value,
  onChange,
  clientName,
  spouseName,
  hasSpouse = false,
}: IncomeStepProps) {
  const income = value ?? [];
  const ownerOpts = ownerOptions(clientName, spouseName, hasSpouse);
  const ownerValues = new Set<Owner>(ownerOpts.map((o) => o.value));

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
      heading="Income"
      addLabel="Add income"
      emptyMessage="No income sources added yet."
      items={income}
      onAdd={addIncome}
      onRemove={removeIncome}
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
            <div>
              <label htmlFor={`${idp}-owner`} className={labelCls}>
                Owner
              </label>
              <select
                id={`${idp}-owner`}
                className={selectCls}
                value={item.owner && ownerValues.has(item.owner) ? item.owner : "client"}
                onChange={(e) =>
                  updateIncome(i, { owner: e.target.value as IncomeItem["owner"] })
                }
                aria-label="Owner"
              >
                {ownerOpts.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

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
