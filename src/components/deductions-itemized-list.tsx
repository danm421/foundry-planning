"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AddDeductionForm } from "@/components/forms/add-deduction-form";

interface ItemizedRow {
  id: string;
  type: "charitable_cash" | "charitable_non_cash" | "salt" | "mortgage_interest" | "other_itemized";
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
const SALT_CAP = 10000;

const TYPE_LABELS: Record<string, string> = {
  charitable_cash: "Charitable (Cash)",
  charitable_non_cash: "Charitable (Non-Cash)",
  salt: "SALT",
  mortgage_interest: "Mortgage Interest",
  other_itemized: "Other Itemized",
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
}: {
  clientId: string;
  rows: ItemizedRow[];
  currentYear: number;
  onChange?: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<ItemizedRow | null>(null);
  const [adding, setAdding] = useState(false);

  // Compute current-year totals (with SALT cap)
  let saltTotal = 0;
  let otherTotal = 0;
  for (const r of rows) {
    if (currentYear < r.startYear || currentYear > r.endYear) continue;
    const yearsSinceStart = currentYear - r.startYear;
    const inflated = r.annualAmount * Math.pow(1 + r.growthRate, yearsSinceStart);
    if (r.type === "salt") saltTotal += inflated;
    else otherTotal += inflated;
  }
  const itemizedTotal = Math.min(saltTotal, SALT_CAP) + otherTotal;

  async function handleDelete(id: string) {
    if (!confirm("Delete this deduction?")) return;
    await fetch(`/api/clients/${clientId}/deductions/${id}`, { method: "DELETE" });
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
        <div className="rounded-md border border-gray-800 bg-gray-900/60 px-4 py-6 text-center text-sm text-gray-400">
          No itemized deductions yet. Click <span className="text-gray-300">Add deduction</span> to start.
        </div>
      ) : (
        <ul className="divide-y divide-gray-800 rounded-md border border-gray-800 bg-gray-900/60">
          {rows.map((r) => {
            const isCappedSalt = r.type === "salt" && r.annualAmount > SALT_CAP;
            return (
              <li key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <div className="flex flex-col">
                  <span className="text-gray-200">
                    {TYPE_LABELS[r.type]} {r.name ? `· ${r.name}` : ""}
                  </span>
                  <span className="text-xs text-gray-500">
                    {OWNER_LABELS[r.owner]} · {r.startYear}-{r.endYear} · {fmt.format(r.annualAmount)}/yr
                    {r.growthRate > 0 ? ` · ${(r.growthRate * 100).toFixed(1)}%/yr` : ""}
                  </span>
                  {isCappedSalt && (
                    <span className="mt-0.5 text-xs text-amber-400">Capped at {fmt.format(SALT_CAP)} (TCJA SALT cap)</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(r)}
                    className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                    aria-label="Edit"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(r.id)}
                    className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-red-400"
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
          <span className="text-gray-400">Total itemized for {currentYear}:</span>
          <span className="tabular-nums font-semibold text-gray-100">{fmt.format(itemizedTotal)}</span>
        </div>
        <p className="text-xs text-gray-500">
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
        />
      )}
    </section>
  );
}
