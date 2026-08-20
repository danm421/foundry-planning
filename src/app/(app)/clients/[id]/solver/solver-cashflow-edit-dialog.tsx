"use client";

import { useState } from "react";
import type { ClientMilestones, YearRef } from "@/lib/milestones";
import type { IncomeTaxType } from "@/lib/solver/types";
import type {
  CashflowDraft,
  CashflowKind,
  CashflowOwner,
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
import { INCOME_TAX_TYPE_LABELS } from "./solver-income-edit-dialog";

export interface CashflowOwnerOption {
  value: CashflowOwner;
  label: string;
}

/** Everything the form needs beyond the row itself. Passed as one object so the
 *  three surfaces that can open this dialog thread one prop, not five. */
export interface CashflowFormContext {
  owners: CashflowOwnerOption[];
  milestones: ClientMilestones;
  clientFirstName: string;
  spouseFirstName: string;
  /** Plan inflation rate as a decimal — the default growth for a new row. */
  resolvedInflationRate: number;
}

/** The add/edit form behind the solver's "+ Add income or expense" button and
 *  behind the pencil on every row it has added this session. */
export function SolverCashflowEditDialog({
  draft,
  isNew,
  ctx,
  onKindChange,
  onCancel,
  onSubmit,
}: {
  draft: CashflowDraft;
  /** A brand-new row: shows the Income/Expense tab strip and an "Add" action. */
  isNew: boolean;
  ctx: CashflowFormContext;
  /** Required for a new row — the tab strip switches which kind is being added.
   *  An existing row has no tab strip, so editing never calls this. */
  onKindChange?(kind: CashflowKind): void;
  onCancel(): void;
  onSubmit(draft: CashflowDraft): void;
}) {
  const { owners, milestones, clientFirstName, spouseFirstName, resolvedInflationRate } = ctx;
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
      onTabChange={isNew ? (id) => onKindChange?.(id as CashflowKind) : undefined}
      primaryAction={{
        label: isNew ? "Add" : "Save",
        onClick: handleSubmit,
        disabled: !valid,
      }}
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
        <div className="col-span-2">
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
          <>
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

            <div>
              <FieldLabel htmlFor="qac-tax-type">Tax treatment</FieldLabel>
              <select
                id="qac-tax-type"
                value={form.taxType ?? "ordinary_income"}
                onChange={(e) => patch({ taxType: e.target.value as IncomeTaxType })}
                className={selectClassName}
              >
                {(Object.keys(INCOME_TAX_TYPE_LABELS) as IncomeTaxType[]).map((k) => (
                  <option key={k} value={k}>
                    {INCOME_TAX_TYPE_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
          </>
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
