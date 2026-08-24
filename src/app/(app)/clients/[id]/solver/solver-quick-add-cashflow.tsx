"use client";

import { useState } from "react";
import type { SolverMutation } from "@/lib/solver/types";
import {
  blankCashflowDraft,
  cashflowUpsertMutation,
  type CashflowDraft,
} from "@/lib/solver/quick-add-cashflow";
import {
  SolverCashflowEditDialog,
  type CashflowFormContext,
} from "./solver-cashflow-edit-dialog";

/**
 * "+ Add income or expense" — mints a new household stream inside the solve.
 *
 * The row it adds is rendered by its own category (Other Income / Other
 * Expenses), not here, so an added row is edited alongside the plan's own rows.
 */
export function SolverQuickAddCashflow({
  ctx,
  onChange,
}: {
  ctx: CashflowFormContext;
  onChange(m: SolverMutation): void;
}) {
  const [draft, setDraft] = useState<CashflowDraft | null>(null);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() =>
          setDraft(
            blankCashflowDraft({
              kind: "income",
              id: crypto.randomUUID(),
              owner: ctx.owners[0]?.value ?? "client",
              milestones: ctx.milestones,
              inflationRate: ctx.resolvedInflationRate,
            }),
          )
        }
        className="rounded-md border border-hair-2 px-3 py-1.5 text-[12px] font-medium text-ink-3 hover:text-ink"
      >
        + Add income or expense
      </button>

      {draft && (
        <SolverCashflowEditDialog
          key={draft.id}
          draft={draft}
          isNew
          ctx={ctx}
          onKindChange={(kind) => setDraft({ ...draft, kind })}
          onCancel={() => setDraft(null)}
          onSubmit={(d) => {
            onChange(cashflowUpsertMutation(d));
            setDraft(null);
          }}
        />
      )}
    </div>
  );
}
