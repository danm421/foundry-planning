"use client";

import { useState } from "react";
import type { ClientData } from "@/engine/types";
import type { ClientMilestones, YearRef } from "@/lib/milestones";
import type { SolverMutation } from "@/lib/solver/types";
import {
  blankCashflowDraft,
  draftFromExpense,
  draftFromIncome,
  expenseFromDraft,
  incomeFromDraft,
  isQuickAddCashflowRow,
  type CashflowDraft,
  type CashflowKind,
  type CashflowOwner,
} from "@/lib/solver/quick-add-cashflow";
import DialogShell from "@/components/dialog-shell";
import { CurrencyInput } from "@/components/currency-input";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import {
  inputBaseClassName,
  inputClassName,
  selectClassName,
  selectBaseClassName,
} from "@/components/forms/input-styles";

export interface CashflowOwnerOption {
  value: CashflowOwner;
  label: string;
}

interface Props {
  /** The tree the solver started from (base, or the loaded scenario). Its
   *  income/expense ids define what was already in the plan. */
  sourceClientData: ClientData;
  /** Working tree — rows here but not in the source were added in this session. */
  workingClientData: ClientData;
  owners: CashflowOwnerOption[];
  milestones: ClientMilestones;
  clientFirstName: string;
  spouseFirstName: string;
  /** Plan inflation rate as a decimal — the default growth for a new row. */
  resolvedInflationRate: number;
  onChange(m: SolverMutation): void;
}

export function SolverQuickAddCashflow({
  sourceClientData,
  workingClientData,
  owners,
  milestones,
  clientFirstName,
  spouseFirstName,
  resolvedInflationRate,
  onChange,
}: Props) {
  const [editing, setEditing] = useState<CashflowDraft | null>(null);

  // Rows present in the working tree but absent from the source tree are what
  // this session added. Deriving them (rather than tracking ids in local state)
  // keeps the list correct across a remount and across a draft reload.
  //   - Compared against the SOURCE, not base, so a loaded scenario's own rows
  //     are never offered up for deletion here.
  //   - Filtered to the "other" type this popup mints, so a synthesized
  //     retirement living expense (living-expense.ts) or an education goal
  //     (solver-education-section.tsx) — both of which reach the working tree
  //     through the same expense-upsert — never appear here with a delete.
  const sourceIncomeIds = new Set(sourceClientData.incomes.map((i) => i.id));
  const sourceExpenseIds = new Set(sourceClientData.expenses.map((e) => e.id));
  const added: CashflowDraft[] = [
    ...workingClientData.incomes
      .filter((i) => !sourceIncomeIds.has(i.id) && isQuickAddCashflowRow(i))
      .map(draftFromIncome),
    ...workingClientData.expenses
      .filter((e) => !sourceExpenseIds.has(e.id) && isQuickAddCashflowRow(e))
      .map(draftFromExpense),
  ];

  function commit(draft: CashflowDraft) {
    onChange(
      draft.kind === "income"
        ? { kind: "income-upsert", id: draft.id, value: incomeFromDraft(draft) }
        : { kind: "expense-upsert", id: draft.id, value: expenseFromDraft(draft) },
    );
    setEditing(null);
  }

  function remove(draft: CashflowDraft) {
    onChange(
      draft.kind === "income"
        ? { kind: "income-upsert", id: draft.id, value: null }
        : { kind: "expense-upsert", id: draft.id, value: null },
    );
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() =>
          setEditing(
            blankCashflowDraft({
              kind: "income",
              id: crypto.randomUUID(),
              owner: owners[0]?.value ?? "client",
              milestones,
              inflationRate: resolvedInflationRate,
            }),
          )
        }
        className="rounded-md border border-hair-2 px-3 py-1.5 text-[12px] font-medium text-ink-3 hover:text-ink"
      >
        + Add income or expense
      </button>

      {added.length > 0 && (
        <ul className="mt-2 space-y-1">
          {added.map((row) => (
            <li key={row.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditing(row)}
                className="flex min-w-0 flex-1 items-baseline gap-2 rounded px-1.5 py-1 text-left hover:bg-card-hover"
                aria-label={`Edit ${row.name}`}
                title="Edit"
              >
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">
                  {row.name}
                </span>
                <span className="tabular shrink-0 text-[12px] text-ink-3">
                  {row.kind === "expense" ? "−" : ""}$
                  {Math.round(row.annualAmount).toLocaleString()}
                </span>
              </button>
              <button
                type="button"
                onClick={() => remove(row)}
                aria-label={`Remove ${row.name}`}
                title="Remove"
                className="shrink-0 rounded px-1.5 py-1 text-[12px] text-ink-4 hover:text-crit"
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <CashflowDialog
          key={editing.id}
          draft={editing}
          isNew={!added.some((r) => r.id === editing.id)}
          owners={owners}
          milestones={milestones}
          clientFirstName={clientFirstName}
          spouseFirstName={spouseFirstName}
          resolvedInflationRate={resolvedInflationRate}
          onKindChange={(kind) => setEditing({ ...editing, kind })}
          onCancel={() => setEditing(null)}
          onSubmit={commit}
        />
      )}
    </div>
  );
}

function CashflowDialog({
  draft,
  isNew,
  owners,
  milestones,
  clientFirstName,
  spouseFirstName,
  resolvedInflationRate,
  onKindChange,
  onCancel,
  onSubmit,
}: {
  draft: CashflowDraft;
  isNew: boolean;
  owners: CashflowOwnerOption[];
  milestones: ClientMilestones;
  clientFirstName: string;
  spouseFirstName: string;
  resolvedInflationRate: number;
  onKindChange(kind: CashflowKind): void;
  onCancel(): void;
  onSubmit(draft: CashflowDraft): void;
}) {
  // One copy of the row, not a field-per-hook mirror of it — otherwise a new
  // CashflowDraft field can get a useState and be forgotten in the submit
  // spread. The two free-text staging strings stay separate: a half-typed
  // "1,2" or "3." is not a number yet.
  const [form, setForm] = useState<CashflowDraft>(draft);
  const [amount, setAmount] = useState(
    draft.annualAmount ? String(draft.annualAmount) : "",
  );
  const [growthPct, setGrowthPct] = useState(
    String(Math.round(draft.growthRate * 10000) / 100),
  );
  const patch = (p: Partial<CashflowDraft>) => setForm((f) => ({ ...f, ...p }));

  const parsedAmount = Number(amount);
  const valid =
    form.name.trim().length > 0 &&
    amount.trim() !== "" &&
    Number.isFinite(parsedAmount) &&
    parsedAmount >= 0 &&
    form.endYear >= form.startYear;

  function handleSubmit() {
    if (!valid) return;
    onSubmit({
      ...form,
      // `kind` lives on the prop — the dialog's tab strip changes it above.
      kind: draft.kind,
      name: form.name.trim(),
      annualAmount: parsedAmount,
      growthRate:
        form.growthSource === "inflation"
          ? resolvedInflationRate
          : (parseFloat(growthPct) || 0) / 100,
    });
  }

  const isIncome = draft.kind === "income";

  return (
    <DialogShell
      open
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
      title={isNew ? `Add ${draft.kind}` : `Edit ${draft.kind}`}
      size="sm"
      tabs={
        isNew
          ? [
              { id: "income", label: "Income" },
              { id: "expense", label: "Expense" },
            ]
          : undefined
      }
      activeTab={draft.kind}
      onTabChange={(id) => onKindChange(id as CashflowKind)}
      primaryAction={{
        label: isNew ? "Add" : "Save",
        onClick: handleSubmit,
        disabled: !valid,
      }}
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
        <div className={isIncome ? "" : "col-span-2"}>
          <FieldLabel htmlFor="qac-name">Name</FieldLabel>
          <input
            id="qac-name"
            data-autofocus
            value={form.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder={isIncome ? "Rental income" : "Travel"}
            className={inputClassName}
          />
        </div>

        {isIncome && (
          <div>
            <FieldLabel htmlFor="qac-owner">Owner</FieldLabel>
            <select
              id="qac-owner"
              value={form.owner ?? owners[0]?.value ?? "client"}
              onChange={(e) => patch({ owner: e.target.value as CashflowOwner })}
              className={selectClassName}
            >
              {owners.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <FieldLabel htmlFor="qac-amount">Annual amount</FieldLabel>
          <CurrencyInput
            id="qac-amount"
            value={amount}
            onChange={setAmount}
            placeholder="0"
          />
        </div>

        <div>
          <FieldLabel htmlFor="qac-growth">Growth</FieldLabel>
          <div className="flex gap-2">
            <select
              id="qac-growth"
              value={form.growthSource}
              onChange={(e) =>
                patch({ growthSource: e.target.value as "custom" | "inflation" })
              }
              className={`${selectBaseClassName} min-w-0 flex-1`}
            >
              <option value="inflation">Inflation</option>
              <option value="custom">Custom</option>
            </select>
            {form.growthSource === "custom" && (
              <input
                type="number"
                step={0.25}
                value={growthPct}
                onChange={(e) => setGrowthPct(e.target.value)}
                aria-label="Annual growth rate (%)"
                className={`${inputBaseClassName} tabular w-[4.5rem] shrink-0 px-2`}
              />
            )}
          </div>
        </div>

        <MilestoneYearPicker
          id="qac-start-year"
          name="startYear"
          label="Start"
          value={form.startYear}
          yearRef={form.startYearRef}
          milestones={milestones}
          position="start"
          clientFirstName={clientFirstName}
          spouseFirstName={spouseFirstName}
          onChange={(y, ref) => patch({ startYear: y, startYearRef: ref })}
        />
        <MilestoneYearPicker
          id="qac-end-year"
          name="endYear"
          label="End"
          value={form.endYear}
          yearRef={form.endYearRef}
          milestones={milestones}
          position="end"
          startYearForDuration={form.startYear}
          clientFirstName={clientFirstName}
          spouseFirstName={spouseFirstName}
          onChange={(y, ref) => patch({ endYear: y, endYearRef: ref as YearRef | null })}
        />
      </div>
      {form.endYear < form.startYear && (
        <p className="mt-2 text-[12px] text-crit">End year is before the start year.</p>
      )}
    </DialogShell>
  );
}

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-ink-2">
      {children}
    </label>
  );
}
