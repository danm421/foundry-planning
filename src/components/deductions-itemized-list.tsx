"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { AddDeductionForm } from "@/components/forms/add-deduction-form";
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

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-200">Itemized deductions</h2>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
        >
          + Add deduction
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-gray-800 bg-gray-900/60 px-4 py-6 text-center text-sm text-gray-300">
          No itemized deductions yet. Click <span className="text-gray-300">Add deduction</span> to start.
        </div>
      ) : (
        <ul className="divide-y divide-gray-800 rounded-md border border-gray-800 bg-gray-900/60">
          {rows.map((r) => {
            const isSaltType = r.type === "property_tax";
            return (
              <li key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <div className="flex flex-col">
                  <span className="text-gray-200">
                    {TYPE_LABELS[r.type]} {r.name ? `· ${r.name}` : ""}
                  </span>
                  <span className="text-xs text-gray-400">
                    {OWNER_LABELS[r.owner]} · {r.startYear}-{r.endYear} · {fmt.format(r.annualAmount)}/yr
                    {r.growthRate > 0 ? ` · ${(r.growthRate * 100).toFixed(1)}%/yr` : ""}
                  </span>
                  {isSaltType && (
                    <span className="mt-0.5 text-xs text-gray-400">Subject to SALT cap</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(r)}
                    className="rounded px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 hover:text-gray-200"
                    aria-label="Edit"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(r.id)}
                    className="rounded px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 hover:text-red-400"
                    aria-label="Delete"
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-300">Total itemized for {currentYear}:</span>
          <span className="tabular-nums font-semibold text-gray-100">{fmt.format(itemizedTotal)}</span>
        </div>
        <p className="text-xs text-gray-400">
          The bracket engine compares this to your standard deduction and uses whichever is larger.
        </p>
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
