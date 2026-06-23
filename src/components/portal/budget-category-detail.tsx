// src/components/portal/budget-category-detail.tsx
"use client";
import { useEffect, useState, type ReactElement } from "react";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import { BudgetHistoryChart } from "@/components/portal/budget-history-chart";
import type {
  CategoryDetail,
  CategoryTransaction,
} from "@/lib/portal/category-detail";

/** Currency with cents — the detail panel shows exact figures (Monarch-style). */
function money(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function monthHeading(monthKey: string): string {
  return new Date(`${monthKey}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function txnDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Group an already-date-DESC list into [monthKey, txns] preserving order. */
function groupByMonth(
  txns: CategoryTransaction[],
): Array<[string, CategoryTransaction[]]> {
  const out: Array<[string, CategoryTransaction[]]> = [];
  const index = new Map<string, CategoryTransaction[]>();
  for (const t of txns) {
    const key = t.date.slice(0, 7);
    let bucket = index.get(key);
    if (!bucket) {
      bucket = [];
      index.set(key, bucket);
      out.push([key, bucket]);
    }
    bucket.push(t);
  }
  return out;
}

function thisMonthLabel(): string {
  return new Date().toLocaleDateString("en-US", { month: "short" });
}

export function BudgetCategoryDetail({
  categoryId,
  editEnabled,
  onBudgetSaved,
}: {
  categoryId: string;
  editEnabled: boolean;
  onBudgetSaved: () => void;
}): ReactElement {
  const portalFetch = usePortalFetch();
  const [detail, setDetail] = useState<CategoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    setEditing(false);
    portalFetch(`/api/portal/budgets/category/${categoryId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("load failed");
        const json = (await res.json()) as { detail: CategoryDetail };
        if (!cancelled) setDetail(json.detail);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [categoryId, portalFetch]);

  async function saveBudget(): Promise<void> {
    if (!detail) return;
    setSaveError(null);
    setSaving(true);
    const parsed = draft.trim() === "" ? null : Number(draft);
    try {
      const res = await portalFetch("/api/portal/budgets", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categoryId: detail.id, monthlyAmount: parsed }),
      });
      if (!res.ok) {
        setSaveError("Couldn't save that budget.");
        return;
      }
      setEditing(false);
      // Tell the parent to refresh the server-rendered list, then re-pull
      // this panel so the chart line + remaining update too.
      onBudgetSaved();
      const reload = await portalFetch(`/api/portal/budgets/category/${detail.id}`);
      if (reload.ok) {
        const json = (await reload.json()) as { detail: CategoryDetail };
        setDetail(json.detail);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading && !detail) {
    return (
      <div className="space-y-4 rounded-xl border border-hair bg-card p-5">
        <div className="h-7 w-40 animate-pulse rounded bg-card-2" />
        <div className="h-32 animate-pulse rounded-lg bg-card-2" />
        <div className="h-24 animate-pulse rounded-lg bg-card-2" />
      </div>
    );
  }

  if (loadError || !detail) {
    return (
      <div className="rounded-xl border border-hair bg-card p-5 text-[13px] text-ink-3">
        Couldn&apos;t load this category.
      </div>
    );
  }

  const remaining = detail.remainingThisMonth;
  const months = groupByMonth(detail.transactions);

  return (
    <div className="space-y-6 rounded-xl border border-hair bg-card p-5">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-card-2 text-[18px]"
            aria-hidden
          >
            {detail.emoji}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: detail.color }}
              />
              <h2 className="truncate text-[22px] font-semibold text-ink">
                {detail.name}
              </h2>
            </div>
            <p className="mt-0.5 text-[12px] text-ink-3">
              Spent in {thisMonthLabel()}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="tabular text-[22px] font-semibold text-ink">
            {money(detail.spentThisMonth)}
          </div>
          {remaining != null && (
            <div
              className={`tabular text-[12px] ${remaining >= 0 ? "text-good" : "text-crit"}`}
            >
              {remaining >= 0
                ? `${money(remaining)} left`
                : `${money(Math.abs(remaining))} over`}
            </div>
          )}
        </div>
      </header>

      {/* Budget edit row */}
      {editEnabled && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-hair bg-card px-3 py-2">
          <span className="text-[12px] text-ink-3">
            Monthly budget{" "}
            <span className="tabular text-ink-2">
              {detail.monthlyBudget != null ? money(detail.monthlyBudget) : "—"}
            </span>
          </span>
          {editing ? (
            <div className="flex items-center gap-2">
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
                disabled={saving}
                onClick={() => void saveBudget()}
                className="rounded-md bg-accent/20 px-2.5 py-1 text-[12px] font-medium text-accent disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-md px-2 py-1 text-[12px] text-ink-3 hover:bg-card-2"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setDraft(detail.monthlyBudget?.toString() ?? "");
              }}
              className="rounded-md border border-hair px-2.5 py-1 text-[11px] text-ink-2 hover:bg-card-2"
            >
              {detail.monthlyBudget != null ? "Edit Budget" : "Set budget"}
            </button>
          )}
        </div>
      )}
      {saveError && <p className="text-[12px] text-crit">{saveError}</p>}

      {/* History chart */}
      <BudgetHistoryChart
        history={detail.history}
        budget={detail.monthlyBudget}
        categoryColor={detail.color}
      />

      {/* Key metrics */}
      {detail.metrics.length > 0 && (
        <section>
          <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-6 gap-y-2 border-t border-hair pt-4">
            <div className="text-[12px] uppercase tracking-wide text-ink-3">
              Key metrics
            </div>
            <div className="text-right text-[11px] uppercase tracking-wide text-ink-3">
              Spent per year
            </div>
            <div className="text-right text-[11px] uppercase tracking-wide text-ink-3">
              Avg monthly
            </div>
            {detail.metrics.map((m) => (
              <div key={m.year} className="contents">
                <div className="tabular text-[13px] text-ink-2">{m.year}</div>
                <div className="tabular text-right text-[13px] text-ink">
                  {money(m.total)}
                </div>
                <div className="tabular text-right text-[13px] text-ink">
                  {money(m.avgMonthly)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Transactions grouped by month */}
      <section className="space-y-4 border-t border-hair pt-4">
        {months.length === 0 && (
          <p className="text-[13px] text-ink-3">No transactions yet.</p>
        )}
        {months.map(([key, txns]) => (
          <div key={key} className="space-y-1">
            <h3 className="text-[14px] font-semibold text-ink">
              {monthHeading(key)}
            </h3>
            <ul>
              {txns.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-3 border-b border-hair/60 py-2 last:border-0"
                >
                  <span className="tabular w-12 shrink-0 text-[12px] text-ink-3">
                    {txnDate(t.date)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
                    {t.merchantName ?? t.name}
                  </span>
                  {t.categoryName && (
                    <span className="hidden items-center gap-1.5 sm:inline-flex">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: t.categoryColor }}
                      />
                      <span className="text-[10px] uppercase tracking-wide text-ink-3">
                        {t.categoryName}
                      </span>
                    </span>
                  )}
                  <span
                    className={`tabular w-20 shrink-0 text-right text-[13px] ${
                      t.amount < 0 ? "text-good" : "text-ink"
                    }`}
                  >
                    {t.amount < 0
                      ? `+${money(-t.amount)}`
                      : `-${money(t.amount)}`}
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
