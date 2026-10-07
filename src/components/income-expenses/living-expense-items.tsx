"use client";

// The line items behind the Current Living Expenses row, shown when that row
// is expanded on the Income & Expenses page (spec 2026-10-07). Presentational:
// every edit hands the parent the WHOLE next list, and the parent's one save
// path (`livingItemsPatch`) turns it into the stored items plus their total.

import { useState } from "react";
import type { LivingExpenseItem, LivingItemFrequency } from "@/engine/types";
import { CurrencyInput } from "@/components/currency-input";
import { InlineAmount } from "@/components/forms/inline-amount";
import {
  isTotalOverridden,
  itemAnnualAmount,
  livingItemsAnnualTotal,
} from "@/lib/living-expense-items";
import { TrashIcon } from "./icons";

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const SHORT: Record<LivingItemFrequency, string> = { monthly: "/mo", annual: "/yr" };

function newItemId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface LivingExpenseItemsProps {
  /** The row's name, for accessible labels. */
  rowName: string;
  items: LivingExpenseItem[];
  /** The row's stored total — differs from the items when another screen set it. */
  annualAmount: number;
  canEdit: boolean;
  /** The row has year-by-year amounts, which beat the items in the projection. */
  hasSchedule: boolean;
  /** A failure the parent wants shown here (the goal saved but the item stayed). */
  error: string | null;
  onSave: (next: LivingExpenseItem[]) => Promise<boolean>;
  onUseItemsTotal: () => Promise<boolean>;
  onMakeGoal: (item: LivingExpenseItem) => void;
}

function FrequencyToggle({
  value,
  onChange,
  label,
}: {
  value: LivingItemFrequency;
  onChange: (next: LivingItemFrequency) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={`How often for ${label}`} className="inline-flex shrink-0 gap-0.5 rounded-md border border-hair p-0.5 text-xs">
      {(["monthly", "annual"] as const).map((f) => (
        <button
          key={f}
          type="button"
          aria-pressed={value === f}
          onClick={() => {
            if (value !== f) onChange(f);
          }}
          className={`rounded border px-1.5 ${
            value === f ? "border-accent bg-accent/15 text-accent" : "border-transparent text-ink-3 hover:text-ink-2"
          }`}
        >
          {SHORT[f]}
        </button>
      ))}
    </div>
  );
}

export default function LivingExpenseItems({
  rowName,
  items,
  annualAmount,
  canEdit,
  hasSchedule,
  error,
  onSave,
  onUseItemsTotal,
  onMakeGoal,
}: LivingExpenseItemsProps) {
  const [draftName, setDraftName] = useState("");
  const [draftAmount, setDraftAmount] = useState("");
  const [draftFrequency, setDraftFrequency] = useState<LivingItemFrequency>("monthly");
  const total = livingItemsAnnualTotal(items);
  const overridden = isTotalOverridden(annualAmount, items);
  const canAdd = draftName.trim() !== "" && draftAmount !== "" && Number(draftAmount) >= 0;

  function replace(id: string, patch: Partial<LivingExpenseItem>) {
    return onSave(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!canAdd) return;
    const ok = await onSave([
      ...items,
      { id: newItemId(), name: draftName.trim(), amount: Number(draftAmount), frequency: draftFrequency },
    ]);
    if (ok) {
      setDraftName("");
      setDraftAmount("");
    }
  }

  return (
    <div data-testid="living-items" className="space-y-1 bg-card-2 py-2 pl-10 pr-4">
      {items.length === 0 && (
        <p className="text-xs text-ink-3">
          Break this total into items. Once you add one, the items set the total.
        </p>
      )}
      {overridden && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-warn/10 px-3 py-1.5 text-xs text-ink-2">
          <span>
            Total set to {money(annualAmount)} elsewhere — items add up to {money(total)}
          </span>
          {canEdit && (
            <button
              type="button"
              onClick={() => void onUseItemsTotal()}
              className="shrink-0 font-medium text-accent hover:text-accent-ink"
            >
              Use items total
            </button>
          )}
        </div>
      )}
      {hasSchedule && items.length > 0 && (
        <p className="text-xs text-ink-3">
          This row has a year-by-year schedule, which the projection uses instead of these items.
        </p>
      )}

      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-2">
          {canEdit ? (
            <input
              aria-label={`Name of ${item.name}`}
              defaultValue={item.name}
              onBlur={(e) => {
                const next = e.currentTarget.value.trim();
                if (!next) {
                  e.currentTarget.value = item.name;
                  return;
                }
                if (next !== item.name) void replace(item.id, { name: next });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  e.currentTarget.value = item.name;
                  e.currentTarget.blur();
                }
              }}
              className="min-w-0 flex-1 truncate rounded bg-transparent px-1 py-0.5 text-sm text-ink hover:bg-card-hover focus:bg-paper focus:outline-none focus:ring-1 focus:ring-accent"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate px-1 text-sm text-ink">{item.name}</span>
          )}
          {canEdit ? (
            <>
              <InlineAmount
                amount={item.amount}
                label={item.name}
                onSave={(n) => replace(item.id, { amount: Math.abs(n) })}
              />
              <FrequencyToggle
                value={item.frequency}
                label={item.name}
                onChange={(frequency) => void replace(item.id, { frequency })}
              />
            </>
          ) : (
            <span className="text-sm text-ink">
              {money(item.amount)}
              {SHORT[item.frequency]}
            </span>
          )}
          <span className="w-[88px] shrink-0 text-right text-xs text-ink-3">
            {money(itemAnnualAmount(item))}/yr
          </span>
          {canEdit && (
            <>
              <button
                type="button"
                aria-label={`Make ${item.name} a goal`}
                onClick={() => onMakeGoal(item)}
                className="shrink-0 text-xs font-medium text-accent hover:text-accent-ink"
              >
                Make it a goal
              </button>
              <button
                type="button"
                aria-label={`Delete ${item.name}`}
                onClick={() => void onSave(items.filter((i) => i.id !== item.id))}
                className="shrink-0 text-ink-4 hover:text-crit"
              >
                <TrashIcon />
              </button>
            </>
          )}
        </div>
      ))}

      {canEdit && (
        <form onSubmit={add} aria-label={`Add an item to ${rowName}`} className="flex items-center gap-2 pt-1">
          <input
            aria-label="New item name"
            placeholder="e.g., Groceries"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-hair bg-paper px-2 py-1 text-sm text-ink placeholder:text-ink-4 focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="w-[120px] shrink-0">
            <CurrencyInput aria-label="New item amount" value={draftAmount} onChange={setDraftAmount} />
          </div>
          <FrequencyToggle value={draftFrequency} onChange={setDraftFrequency} label="the new item" />
          <button
            type="submit"
            disabled={!canAdd}
            className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-on hover:bg-accent-ink disabled:opacity-50"
          >
            + Add item
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-xs text-crit">
          {error}
        </p>
      )}
    </div>
  );
}
