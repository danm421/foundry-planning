"use client";
import { useState } from "react";
import type { ReactElement } from "react";
import { useRouter } from "next/navigation";
import { RecurringCreateDialog } from "@/components/portal/recurring-create-dialog";

type CategoryRow = { id: string; name: string; kind: "group" | "category"; parentId: string | null };
type RecurringRow = {
  id: string; name: string; cadence: "monthly" | "annually"; dueDay: number | null;
  dueMonth: number | null; categoryId: string; predicted: number;
  state: "paid" | "due" | "overdue"; postedThisMonth: number;
};
type Data = { recurrings: RecurringRow[]; paidSoFar: number; leftToPay: number; month: string };

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const STATE_ORDER: Record<RecurringRow["state"], number> = { overdue: 0, due: 1, paid: 2 };
const STATE_LABEL: Record<RecurringRow["state"], string> = {
  overdue: "Overdue", due: "Due", paid: "Paid",
};

export default function RecurringsView({
  data,
  categories,
  editEnabled,
}: {
  data: Data;
  categories: CategoryRow[];
  editEnabled: boolean;
}): ReactElement {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const sorted = [...data.recurrings].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);

  return (
    <div className="space-y-6 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-[18px] font-semibold text-ink">Recurrings</h1>
        {editEnabled && (
          <button type="button" onClick={() => setCreating(true)}
            className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-on">
            + New recurring
          </button>
        )}
      </header>

      <section className="flex gap-8 rounded-xl border border-hair bg-card p-5">
        <div>
          <p className="tabular text-[20px] font-semibold text-ink">{money(data.leftToPay)}</p>
          <p className="text-[12px] text-ink-3">left to pay</p>
        </div>
        <div>
          <p className="tabular text-[20px] font-semibold text-ink">{money(data.paidSoFar)}</p>
          <p className="text-[12px] text-ink-3">paid so far</p>
        </div>
      </section>

      <section className="space-y-1">
        <h2 className="text-[13px] font-medium text-ink-2">This month</h2>
        {sorted.length === 0 ? (
          <p className="text-[13px] text-ink-3">
            No recurrings yet. Create one from a transaction, or use &quot;+ New recurring&quot;.
          </p>
        ) : (
          <ul className="divide-y divide-hair rounded-xl border border-hair bg-card">
            {sorted.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span className={
                    r.state === "overdue" ? "text-crit" : r.state === "paid" ? "text-ink-3" : "text-ink-2"
                  }>{STATE_LABEL[r.state]}</span>
                  <span className="text-[13px] text-ink">{r.name}</span>
                  <span className="text-[12px] text-ink-3">
                    {r.cadence === "monthly" ? "Monthly" : "Annually"}
                  </span>
                </div>
                <span className="tabular text-[13px] text-ink">
                  {money(r.state === "paid" ? r.postedThisMonth : r.predicted)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {creating && (
        <RecurringCreateDialog
          seed={{ name: "", merchantName: null, categoryId: null, amount: 0 }}
          categories={categories}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); router.refresh(); }}
        />
      )}
    </div>
  );
}
