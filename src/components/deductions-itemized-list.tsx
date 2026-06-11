"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { AddDeductionForm } from "@/components/forms/add-deduction-form";
import { HelpTip } from "@/components/help-tip";
import type { ClientMilestones } from "@/lib/milestones";

interface ItemizedRow {
  id: string;
  type: "charitable" | "above_line" | "below_line" | "property_tax";
  name: string | null;
  owner: "client" | "spouse" | "joint";
  annualAmount: number;
  growthRate: number;
  startYear: number;
  endYear: number;
  startYearRef: string | null;
  endYearRef: string | null;
}

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const TYPE_LABELS: Record<string, string> = {
  charitable: "Charitable",
  above_line: "Above-the-Line",
  below_line: "Below-the-Line",
  property_tax: "Property Tax (SALT)",
};

const OWNER_LABELS: Record<string, string> = {
  client: "Client",
  spouse: "Spouse",
  joint: "Joint",
};

export function DeductionsItemizedList({
  clientId,
  rows,
  currentYear,
  onChange,
  milestones,
  clientFirstName,
  spouseFirstName,
}: {
  clientId: string;
  rows: ItemizedRow[];
  currentYear: number;
  onChange?: () => void;
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
}) {
  const router = useRouter();
  const writer = useScenarioWriter(clientId);
  const [editing, setEditing] = useState<ItemizedRow | null>(null);
  const [adding, setAdding] = useState(false);

  // Compute current-year totals (display only — engine applies SALT cap separately)
  let total = 0;
  for (const r of rows) {
    if (currentYear < r.startYear || currentYear > r.endYear) continue;
    const yearsSinceStart = currentYear - r.startYear;
    const inflated = r.annualAmount * Math.pow(1 + r.growthRate, yearsSinceStart);
    total += inflated;
  }
  const itemizedTotal = total;

  async function handleDelete(id: string) {
    if (!confirm("Delete this deduction?")) return;
    await writer.submit(
      { op: "remove", targetKind: "client_deduction", targetId: id },
      { url: `/api/clients/${clientId}/deductions/${id}`, method: "DELETE" },
    );
    router.refresh();
    onChange?.();
  }

  // Row template: Type | Name | Owner | Years | Amount | Growth | Actions
  const ROW_GRID =
    "grid grid-cols-[7rem_minmax(0,1.4fr)_5rem_6rem_7rem_5rem_auto] items-center gap-3 px-3 py-1.5";

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
            Itemized deductions
          </h2>
          <HelpTip text="The bracket engine compares your itemized total to the standard deduction (inflated by the tax-inflation rate) and uses whichever is larger. Each row inflates with its own growth rate." />
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-on hover:bg-accent-ink"
        >
          + Add deduction
        </button>
      </div>

      <div className="overflow-hidden rounded-md border border-gray-800 bg-gray-900/40">
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            No itemized deductions yet. Click <span className="text-gray-300">+ Add deduction</span> to start.
          </div>
        ) : (
          <>
            <div className={`${ROW_GRID} border-b border-gray-800 bg-gray-900/60 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400`}>
              <span>Type</span>
              <span>Name</span>
              <span>Owner</span>
              <span>Years</span>
              <span className="text-right">Amount / yr</span>
              <span className="text-right">Growth</span>
              <span className="text-right">Actions</span>
            </div>
            <ol className="divide-y divide-gray-800">
              {rows.map((r) => {
                const isSaltType = r.type === "property_tax";
                return (
                  <li key={r.id} className={`${ROW_GRID} text-sm`}>
                    <span className="flex items-center gap-1 truncate text-xs text-gray-300">
                      <span className="truncate">{TYPE_LABELS[r.type]}</span>
                      {isSaltType && <HelpTip text="Subject to the SALT cap." />}
                    </span>
                    <span className="truncate text-gray-100">{r.name ?? "—"}</span>
                    <span className="truncate text-xs text-gray-400">{OWNER_LABELS[r.owner]}</span>
                    <span className="truncate text-xs tabular-nums text-gray-400">
                      {r.startYear}–{r.endYear}
                    </span>
                    <span className="justify-self-end tabular-nums text-gray-200">
                      {fmt.format(r.annualAmount)}
                    </span>
                    <span className="justify-self-end tabular-nums text-xs text-gray-400">
                      {r.growthRate > 0 ? `${(r.growthRate * 100).toFixed(1)}%` : "—"}
                    </span>
                    <div className="flex shrink-0 items-center justify-end gap-1">
                      <button
                        type="button"
                        title="Edit"
                        aria-label={`Edit ${r.name ?? "deduction"}`}
                        onClick={() => setEditing(r)}
                        className="rounded border border-gray-700 px-2 py-0.5 text-xs text-gray-200 hover:bg-gray-800"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        aria-label={`Delete ${r.name ?? "deduction"}`}
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
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>

      <div className="mt-3 flex justify-between rounded-md border border-gray-800 bg-gray-900/40 px-4 py-2 text-sm">
        <span className="text-gray-300">Total itemized for {currentYear}</span>
        <span className="tabular-nums font-semibold text-gray-100">{fmt.format(itemizedTotal)}</span>
      </div>

      {(adding || editing) && (
        <AddDeductionForm
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
