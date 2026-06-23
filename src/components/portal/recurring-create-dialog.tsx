"use client";
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { CategoryPicker } from "@/components/portal/category-picker";
import { usePortalFetch } from "@/components/portal/portal-mode-context";

type CategoryRow = { id: string; name: string; kind: "group" | "category"; parentId: string | null };

export function RecurringCreateDialog({
  seed,
  categories,
  onClose,
  onCreated,
}: {
  seed: { name: string; merchantName: string | null; categoryId: string | null; amount: number };
  categories: CategoryRow[];
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const portalFetch = usePortalFetch();
  const [name, setName] = useState(seed.merchantName ?? seed.name);
  const [matchType, setMatchType] = useState<"contains" | "exact">("contains");
  const [pattern, setPattern] = useState(seed.merchantName ?? seed.name);
  // Seed a ±20% window around the source transaction amount.
  const [amountMin, setAmountMin] = useState(String(Math.max(0, Math.round(seed.amount * 0.8))));
  const [amountMax, setAmountMax] = useState(String(Math.round(seed.amount * 1.2)));
  const [cadence, setCadence] = useState<"monthly" | "annually">("monthly");
  const [anytime, setAnytime] = useState(true);
  const [dueDay, setDueDay] = useState("1");
  const [dueMonth, setDueMonth] = useState("1");
  const [categoryId, setCategoryId] = useState<string | null>(seed.categoryId);
  const [count, setCount] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pattern.trim()) { setCount(null); return; }
    const handle = setTimeout(() => {
      const p = new URLSearchParams({
        matchType, pattern: pattern.trim(), amountMin: amountMin || "0", amountMax: amountMax || "0",
      });
      void portalFetch(`/api/portal/recurrings/preview?${p.toString()}`)
        .then((r) => (r.ok ? r.json() : { count: null }))
        .then((d: { count: number | null }) => setCount(d.count))
        .catch(() => setCount(null));
    }, 300);
    return () => clearTimeout(handle);
  }, [matchType, pattern, amountMin, amountMax, portalFetch]);

  async function submit() {
    if (!categoryId || !pattern.trim() || !name.trim()) {
      setError("Name, pattern, and category are required."); return;
    }
    const min = Number(amountMin); const max = Number(amountMax);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      setError("Enter a valid amount range."); return;
    }
    setSubmitting(true); setError(null);
    try {
      const res = await portalFetch("/api/portal/recurrings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), matchType, pattern: pattern.trim(),
          amountMin: min, amountMax: max, cadence,
          dueDay: cadence === "monthly" && !anytime ? Number(dueDay) : null,
          dueMonth: cadence === "annually" ? Number(dueMonth) : null,
          categoryId,
        }),
      });
      if (!res.ok) { setError("Couldn't create the recurring."); return; }
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-paper/70 p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-hair bg-card p-5">
        <h2 className="text-[15px] font-semibold text-ink">New recurring transaction</h2>

        <label className="block space-y-1">
          <span className="text-[12px] text-ink-3">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink" />
        </label>

        <label className="block space-y-1">
          <span className="text-[12px] text-ink-3">Match type</span>
          <select value={matchType} onChange={(e) => setMatchType(e.target.value as "contains" | "exact")}
            className="w-full rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink-2">
            <option value="contains">Name contains</option>
            <option value="exact">Name is exactly</option>
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-[12px] text-ink-3">Match pattern</span>
          <input value={pattern} onChange={(e) => setPattern(e.target.value)}
            className="w-full rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink" />
        </label>

        <div className="flex gap-2">
          <label className="block flex-1 space-y-1">
            <span className="text-[12px] text-ink-3">Min amount</span>
            <input value={amountMin} onChange={(e) => setAmountMin(e.target.value)} inputMode="decimal"
              className="w-full rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink" />
          </label>
          <label className="block flex-1 space-y-1">
            <span className="text-[12px] text-ink-3">Max amount</span>
            <input value={amountMax} onChange={(e) => setAmountMax(e.target.value)} inputMode="decimal"
              className="w-full rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink" />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-[12px] text-ink-3">How often</span>
          <select value={cadence} onChange={(e) => setCadence(e.target.value as "monthly" | "annually")}
            className="w-full rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink-2">
            <option value="monthly">Monthly</option>
            <option value="annually">Annually</option>
          </select>
        </label>

        {cadence === "monthly" ? (
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-[12px] text-ink-3">
              <input type="checkbox" checked={anytime} onChange={(e) => setAnytime(e.target.checked)} />
              Anytime in the month
            </label>
            {!anytime && (
              <label className="block space-y-1">
                <span className="text-[12px] text-ink-3">Due day (1-31)</span>
                <input value={dueDay} onChange={(e) => setDueDay(e.target.value)} inputMode="numeric"
                  className="w-full rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink" />
              </label>
            )}
          </div>
        ) : (
          <label className="block space-y-1">
            <span className="text-[12px] text-ink-3">Due month (1-12)</span>
            <input value={dueMonth} onChange={(e) => setDueMonth(e.target.value)} inputMode="numeric"
              className="w-full rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink" />
          </label>
        )}

        <label className="block space-y-1">
          <span className="text-[12px] text-ink-3">Category</span>
          <CategoryPicker categories={categories} value={categoryId} onPick={setCategoryId} />
        </label>

        {count !== null && (
          <p className="tabular text-[12px] text-ink-3">Matches {count} past transactions.</p>
        )}
        {error && <p className="text-[12px] text-crit">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="rounded-md border border-hair px-3 py-1.5 text-[13px] text-ink-2 hover:bg-card-2">Cancel</button>
          <button type="button" disabled={submitting} onClick={() => void submit()}
            className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-on disabled:opacity-50">
            {submitting ? "Saving…" : "Create recurring"}
          </button>
        </div>
      </div>
    </div>
  );
}
