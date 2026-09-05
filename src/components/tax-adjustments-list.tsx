"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import {
  AddTaxAdjustmentForm,
  type TaxAdjustmentRow,
} from "@/components/forms/add-tax-adjustment-form";
import type { ClientMilestones } from "@/lib/milestones";
import { useClientAccess } from "@/components/client-access-provider";

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const TAX_TYPE_LABELS: Record<string, string> = {
  earned_income: "Earned Income",
  ordinary_income: "Ordinary Income",
  dividends: "Dividends",
  capital_gains: "Capital Gains (LT)",
  stcg: "ST Capital Gains",
  qbi: "QBI",
  tax_exempt: "Other Tax-Free Income",
  muni_interest: "Municipal Bond Interest",
};

const OWNER_LABELS: Record<string, string> = {
  client: "Client",
  spouse: "Spouse",
  joint: "Joint",
};

/** Dollar figure for the "Tax paid" column, raw (un-inflated) same as the
 *  Amount column — "amount" mode is already dollars; "percent" mode is a
 *  0..1 fraction of the row's own annualAmount. */
function taxPaidDollars(r: TaxAdjustmentRow): number {
  if (r.withheldMode === "amount") return r.withheldValue;
  if (r.withheldMode === "percent") return r.withheldValue * r.annualAmount;
  return 0;
}

export function TaxAdjustmentsList({
  clientId,
  rows,
  currentYear,
  onChange,
  milestones,
  clientFirstName,
  spouseFirstName,
}: {
  clientId: string;
  rows: TaxAdjustmentRow[];
  currentYear: number;
  onChange?: () => void;
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
}) {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const router = useRouter();
  const writer = useScenarioWriter(clientId);
  const [editing, setEditing] = useState<TaxAdjustmentRow | null>(null);
  const [adding, setAdding] = useState(false);

  // Compute current-year totals (display only). SIGNED — a negative row
  // (income the plan over-counts) subtracts from the total; never clamped.
  let currentYearTotal = 0;
  for (const r of rows) {
    if (currentYear < r.startYear || currentYear > r.endYear) continue;
    currentYearTotal += r.annualAmount * Math.pow(1 + r.growthRate, currentYear - r.startYear);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this tax adjustment?")) return;
    await writer.submit(
      { op: "remove", targetKind: "client_tax_adjustment", targetId: id },
      { url: `/api/clients/${clientId}/tax-adjustments/${id}`, method: "DELETE" },
    );
    router.refresh();
    onChange?.();
  }

  // Row template: Treatment | Description | Owner | Years | Amount | Tax paid | Actions
  const ROW_GRID =
    "grid grid-cols-[9rem_minmax(0,1.3fr)_5rem_6rem_7rem_6rem_auto] items-center gap-3 px-3 py-1.5";

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
          Tax adjustments
        </h2>
        {canEdit && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-on hover:bg-accent-ink"
          >
            + Add tax adjustment
          </button>
        )}
      </div>

      <p className="mb-3 text-sm text-gray-400">
        Income that has already happened. The plan includes it in the tax math — brackets,
        Medicare premiums, how much of Social Security is taxable — but no money moves, because
        the accounts already reflect it.
      </p>

      <div className="overflow-hidden rounded-md border border-gray-800 bg-gray-900/40">
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            No tax adjustments yet. Click <span className="text-gray-300">+ Add tax adjustment</span> to start.
          </div>
        ) : (
          <>
            <div className={`${ROW_GRID} border-b border-gray-800 bg-gray-900/60 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400`}>
              <span>Treatment</span>
              <span>Description</span>
              <span>Owner</span>
              <span>Years</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Tax paid</span>
              <span className="text-right">Actions</span>
            </div>
            <ol className="divide-y divide-gray-800">
              {rows.map((r) => {
                const paid = taxPaidDollars(r);
                return (
                  <li key={r.id} className={`${ROW_GRID} text-sm`}>
                    <span className="truncate text-xs text-gray-300">{TAX_TYPE_LABELS[r.taxType] ?? r.taxType}</span>
                    <span className="truncate text-gray-100">{r.name ?? "—"}</span>
                    <span className="truncate text-xs text-gray-400">{OWNER_LABELS[r.owner]}</span>
                    <span className="truncate text-xs tabular-nums text-gray-400">
                      {r.startYear}–{r.endYear}
                    </span>
                    <span className="justify-self-end tabular-nums text-gray-200">
                      {fmt.format(r.annualAmount)}
                    </span>
                    <span className="justify-self-end tabular-nums text-xs text-gray-400">
                      {r.withheldMode === "none" ? "—" : fmt.format(paid)}
                    </span>
                    {canEdit && (
                      <div className="flex shrink-0 items-center justify-end gap-1">
                        <button
                          type="button"
                          title="Edit"
                          aria-label={`Edit ${r.name ?? "tax adjustment"}`}
                          onClick={() => setEditing(r)}
                          className="rounded border border-gray-700 px-2 py-0.5 text-xs text-gray-200 hover:bg-gray-800"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          title="Delete"
                          aria-label={`Delete ${r.name ?? "tax adjustment"}`}
                          onClick={() => handleDelete(r.id)}
                          className="rounded p-1 text-white hover:bg-white/10 hover:text-white"
                        >
                          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                            <path
                              fillRule="evenodd"
                              d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>

      <div className="mt-3 flex justify-between rounded-md border border-gray-800 bg-gray-900/40 px-4 py-2 text-sm">
        <span className="text-gray-300">Total for {currentYear}</span>
        <span className="tabular-nums font-semibold text-gray-100">{fmt.format(currentYearTotal)}</span>
      </div>

      {canEdit && (adding || editing) && (
        <AddTaxAdjustmentForm
          clientId={clientId}
          existing={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            router.refresh();
            onChange?.();
          }}
          milestones={milestones}
          clientFirstName={clientFirstName}
          spouseFirstName={spouseFirstName}
        />
      )}
    </section>
  );
}
