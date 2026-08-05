"use client";

import type { IntakeDraft } from "@/lib/intake/schema";
import { incomeSpanLabel } from "@/lib/intake/income-years";
import {
  CardList,
  MoneyInput,
  OwnerField,
  YearInput,
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

function blankIncome(currentYear: number): IncomeItem {
  return {
    name: "",
    type: "salary",
    annualAmount: 0,
    owner: "client",
    startYear: currentYear,
    endsAtRetirement: false,
  };
}

// ─── IncomeStep ───────────────────────────────────────────────────────────────
//
// One income source is open for editing at a time; every other one collapses to
// a summary row (name · type · owner · span · annual amount) with Edit / remove
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

  // Read per render, not once at module load: a cached year would hydrate
  // against a different one across a New Year boundary, and would seed new rows
  // with last year in a session left open overnight.
  const currentYear = new Date().getFullYear();
  const total = income.reduce((sum, item) => sum + (item.annualAmount ?? 0), 0);

  function addIncome() {
    onChange([...income, blankIncome(currentYear)]);
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
        subtitle: `${labelFor(TYPE_OPTIONS, item.type)} · ${labelFor(ownerOpts, item.owner)} · ${incomeSpanLabel(item, currentYear)}`,
        amount: item.annualAmount,
      })}
      renderItem={(item, i) => {
        const idp = `income-${i}`;
        const endsAtRetirement = item.endsAtRetirement ?? false;
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

            {/* Amount · Starts · Ends — one line */}
            <div className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-3">
              <div>
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

              <div>
                <label htmlFor={`${idp}-startYear`} className={labelCls}>
                  Starts
                </label>
                <YearInput
                  id={`${idp}-startYear`}
                  value={item.startYear}
                  onChange={(year) => updateIncome(i, { startYear: year })}
                  ariaLabel="Start year"
                  placeholder={String(currentYear)}
                />
              </div>

              <div>
                <label htmlFor={`${idp}-endYear`} className={labelCls}>
                  Ends
                </label>
                <div className="flex items-center gap-2">
                  <YearInput
                    id={`${idp}-endYear`}
                    value={item.endYear}
                    onChange={(year) => updateIncome(i, { endYear: year })}
                    ariaLabel="End year"
                    placeholder={endsAtRetirement ? "—" : "Plan end"}
                    disabled={endsAtRetirement}
                  />
                  <label className="flex shrink-0 items-center gap-1.5 text-[13px] text-ink-2">
                    <input
                      type="checkbox"
                      checked={endsAtRetirement}
                      onChange={(e) =>
                        updateIncome(i, {
                          endsAtRetirement: e.target.checked,
                          // Drop a year the row no longer ends on, so a disabled
                          // field can't submit a stale one.
                          ...(e.target.checked ? { endYear: undefined } : {}),
                        })
                      }
                      className="h-4 w-4 shrink-0 rounded border-hair bg-card-2 text-accent focus:ring-1 focus:ring-accent"
                    />
                    Retirement
                  </label>
                </div>
              </div>
            </div>
          </div>
        );
      }}
    />
  );
}
