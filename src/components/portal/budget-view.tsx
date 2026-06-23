// src/components/portal/budget-view.tsx
"use client";
import { useState, useTransition, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import { fmtUsd } from "@/lib/portal/format";
import { BudgetDonut } from "@/components/portal/budget-donut";
import type { BudgetSummary, GroupCell } from "@/lib/portal/budget-summary";

type Summary = BudgetSummary & { month: string };

function Metric({
  label, value, tone = "ink",
}: { label: string; value: string; tone?: "ink" | "good" | "crit" }): ReactElement {
  const valCls = tone === "good" ? "text-good" : tone === "crit" ? "text-crit" : "text-ink";
  return (
    <div className="rounded-xl border border-hair bg-card p-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-3">{label}</div>
      <div className={`tabular text-[16px] font-semibold ${valCls}`}>{value}</div>
    </div>
  );
}

function BudgetBar({
  actual, budget, color,
}: { actual: number; budget: number | null; color: string }): ReactElement {
  const pct = budget && budget > 0 ? Math.min(100, (actual / budget) * 100) : 0;
  const over = budget != null && actual > budget;
  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-card-2">
      <div
        className="h-full rounded-full"
        style={{ width: `${pct}%`, background: over ? "var(--crit)" : color }}
      />
    </div>
  );
}

export default function BudgetView({
  summary, editEnabled,
}: { summary: Summary; editEnabled: boolean }): ReactElement {
  const router = useRouter();
  const portalFetch = usePortalFetch();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function save(categoryId: string): Promise<void> {
    setError(null);
    const parsed = draft.trim() === "" ? null : Number(draft);
    const res = await portalFetch("/api/portal/budgets", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ categoryId, monthlyAmount: parsed }),
    });
    if (!res.ok) { setError("Couldn't save that budget."); return; }
    setEditingId(null);
    startTransition(() => router.refresh());
  }

  const monthLabel = new Date(`${summary.month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long", year: "numeric", timeZone: "UTC",
  });
  const overall = summary.totalRemaining;

  return (
    <div className="max-w-3xl space-y-5 p-5">
      <header className="space-y-1">
        <h1 className="text-[18px] font-semibold text-ink">Budget</h1>
        <p className="text-[13px] text-ink-3">Spending vs budget for {monthLabel}.</p>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <Metric label="Spent" value={fmtUsd(summary.totalSpent)} />
        <Metric label="Budget" value={summary.totalBudget > 0 ? fmtUsd(summary.totalBudget) : "—"} />
        <Metric
          label={overall >= 0 ? "Remaining" : "Over"}
          value={fmtUsd(Math.abs(overall))}
          tone={overall >= 0 ? "good" : "crit"}
        />
      </div>

      <BudgetDonut groups={summary.groups} totalSpent={summary.totalSpent} />

      {summary.incomeThisMonth > 0 && (
        <p className="text-[12px] text-ink-3">
          Income this month:{" "}
          <span className="tabular text-good">{fmtUsd(summary.incomeThisMonth)}</span>
        </p>
      )}

      {error && <p className="text-[12px] text-crit">{error}</p>}

      <section className="space-y-3">
        {summary.groups.map((g: GroupCell) => (
          <div key={g.id} className="rounded-xl border border-hair bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
                <span className="text-[14px] font-medium text-ink">{g.name}</span>
              </div>
              <div className="flex items-center gap-2">
                {editingId === g.id ? (
                  <>
                    <input
                      aria-label="Budget amount"
                      inputMode="decimal"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="0"
                      className="w-24 rounded-md border border-hair bg-card-2 px-2 py-1 text-right text-[13px] tabular text-ink"
                    />
                    <button
                      type="button"
                      aria-label="Save budget"
                      disabled={pending}
                      onClick={() => void save(g.id)}
                      className="rounded-md bg-accent/20 px-2 py-1 text-[12px] font-medium text-accent disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-md px-2 py-1 text-[12px] text-ink-3 hover:bg-card-2"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="tabular text-[13px] text-ink-2">
                      {fmtUsd(g.actual)}
                      {g.budget != null && <span className="text-ink-4"> / {fmtUsd(g.budget)}</span>}
                    </span>
                    {editEnabled && (
                      <button
                        type="button"
                        aria-label="Edit budget"
                        onClick={() => { setEditingId(g.id); setDraft(g.budget?.toString() ?? ""); }}
                        className="rounded-md border border-hair px-2 py-1 text-[11px] text-ink-3 hover:bg-card-2"
                      >
                        {g.budget != null ? "Edit" : "Set budget"}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
            <BudgetBar actual={g.actual} budget={g.budget} color={g.color} />
            <ul className="mt-3 space-y-1.5">
              {g.leaves.map((l) => (
                <li key={l.id} className="flex items-center justify-between text-[12px]">
                  <span className="text-ink-2">{l.name}</span>
                  <span className="tabular text-ink-3">
                    {fmtUsd(l.actual)}
                    {l.budget != null && <span className="text-ink-4"> / {fmtUsd(l.budget)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
