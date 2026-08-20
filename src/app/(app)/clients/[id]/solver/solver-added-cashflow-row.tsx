"use client";

import { useState } from "react";
import type { SolverMutation } from "@/lib/solver/types";
import {
  cashflowRemoveMutation,
  cashflowUpsertMutation,
  type CashflowDraft,
} from "@/lib/solver/quick-add-cashflow";
import { FieldHintPopover, type HintRow } from "@/components/forms/field-hint-popover";
import { CurrencyAmountInput } from "./solver-currency-amount-input";
import {
  SolverCashflowEditDialog,
  type CashflowFormContext,
} from "./solver-cashflow-edit-dialog";

/**
 * One income or expense the advisor added inside this solve, rendered as a cell
 * of the same two-across grid its category's plan rows sit in — so an added row
 * is edited where it belongs rather than in a list of its own.
 *
 * Every edit re-emits a FULL upsert on the same id, never a field lever: a
 * lever like `income-annual-amount` is dropped by save-to-base's
 * source-membership guard for a row the plan has never seen.
 */
export function SolverAddedCashflowRow({
  draft,
  label,
  hintRows,
  ctx,
  onChange,
}: {
  /** The added row, already in draft form — its `kind` says which upsert it
   *  commits with, so this component never touches an engine type. */
  draft: CashflowDraft;
  label: string;
  /** Detail rows for the label's hint popover. Computed by the category, which
   *  owns how its rows read. */
  hintRows?: HintRow[];
  ctx: CashflowFormContext;
  onChange(m: SolverMutation): void;
}) {
  const [editing, setEditing] = useState(false);
  const inputId = `qac-row-${draft.id}`;

  return (
    <div>
      <div className="flex min-w-0 items-center gap-1.5">
        <label className="min-w-0 truncate text-[11px] text-ink-3" htmlFor={inputId}>
          {label}
        </label>
        {hintRows?.length ? (
          <FieldHintPopover label={`${label} details`} rows={hintRows} />
        ) : null}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <CurrencyAmountInput
          id={inputId}
          label={label}
          value={draft.annualAmount}
          onCommit={(n) => onChange(cashflowUpsertMutation({ ...draft, annualAmount: n }))}
        />
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-hair-2 bg-card-2 text-ink-3 hover:bg-card-hover hover:text-ink-2 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          aria-label={`Edit ${label}`}
          title="Edit"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
            <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474L4.42 15.14a.75.75 0 0 1-.36.198l-3.25.75a.75.75 0 0 1-.902-.901l.75-3.25a.75.75 0 0 1 .198-.36L11.013 1.427Z" />
          </svg>
        </button>
      </div>
      {/* The remove action rides the caption line rather than a third control
          beside the input: a half-column of the inputs pane is ~200px, which an
          input + pencil already fills. */}
      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-ink-4">
        <span className="truncate">added in this solve</span>
        <span aria-hidden="true">&middot;</span>
        <button
          type="button"
          onClick={() => onChange(cashflowRemoveMutation(draft.kind, draft.id))}
          className="shrink-0 font-medium hover:text-crit hover:underline focus-visible:outline-none focus-visible:underline"
          aria-label={`Remove ${label}`}
        >
          Remove
        </button>
      </div>

      {editing ? (
        <SolverCashflowEditDialog
          draft={draft}
          isNew={false}
          ctx={ctx}
          onCancel={() => setEditing(false)}
          onSubmit={(d) => {
            onChange(cashflowUpsertMutation(d));
            setEditing(false);
          }}
        />
      ) : null}
    </div>
  );
}
