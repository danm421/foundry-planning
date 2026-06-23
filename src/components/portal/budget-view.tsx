// src/components/portal/budget-view.tsx
"use client";
import { useMemo, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { fmtUsd } from "@/lib/portal/format";
import { categoryEmoji } from "@/lib/portal/category-emoji";
import { BudgetDonut } from "@/components/portal/budget-donut";
import { BudgetCategoryDetail } from "@/components/portal/budget-category-detail";
import type { BudgetSummary, GroupCell, LeafCell } from "@/lib/portal/budget-summary";

type Summary = BudgetSummary & { month: string };

function Chevron({ open }: { open: boolean }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${open ? "rotate-90" : ""}`}
      aria-hidden
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** Spent-vs-budget track: green under, red over, empty when no budget. */
function MiniBar({
  actual,
  budget,
}: {
  actual: number;
  budget: number | null;
}): ReactElement {
  const has = budget != null && budget > 0;
  const pct = has ? Math.min(100, Math.max(0, (actual / budget) * 100)) : 0;
  const over = has && actual > budget;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-2">
      {has && (
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: over ? "var(--crit)" : "var(--good)" }}
        />
      )}
    </div>
  );
}

function Amounts({
  actual,
  budget,
  muted,
}: {
  actual: number;
  budget: number | null;
  muted?: boolean;
}): ReactElement {
  return (
    <>
      <span
        className={`tabular w-16 shrink-0 text-right text-[12px] ${muted ? "text-ink-3" : "text-ink-2"}`}
      >
        {fmtUsd(actual)}
      </span>
      <span className="hidden w-24 shrink-0 sm:block">
        <MiniBar actual={actual} budget={budget} />
      </span>
      <span className="tabular w-14 shrink-0 text-right text-[12px] text-ink-4">
        {budget != null ? fmtUsd(budget) : "—"}
      </span>
    </>
  );
}

export default function BudgetView({
  summary,
  editEnabled,
}: {
  summary: Summary;
  editEnabled: boolean;
}): ReactElement {
  const router = useRouter();

  const defaultId = useMemo(() => {
    const spend = summary.groups.find((g) => g.actual > 0);
    return (spend ?? summary.groups[0])?.id ?? "";
  }, [summary.groups]);

  const [selectedId, setSelectedId] = useState<string>(defaultId);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(summary.groups.filter((g) => g.actual > 0).map((g) => g.id)),
  );
  // The detail rail (#portal-detail) is server-rendered by the portal layout, so
  // it's already in the DOM when this client component hydrates. Resolve it once
  // (null on the server) without a setState-in-effect.
  const [detailEl] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : document.getElementById("portal-detail"),
  );

  function selectGroup(g: GroupCell): void {
    setSelectedId(g.id);
    setExpanded((prev) => new Set(prev).add(g.id));
  }
  function toggle(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const monthLabel = new Date(`${summary.month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const monthShort = new Date(`${summary.month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });

  const rowBase =
    "flex flex-1 items-center gap-3 rounded-md px-1.5 py-1.5 text-left transition-colors";
  const selCls = "bg-card-2 ring-1 ring-inset ring-hair-2";
  const hovCls = "hover:bg-card-2/60";

  return (
    <div className="space-y-4 p-5">
      <header className="space-y-0.5">
        <h1 className="text-[18px] font-semibold text-ink">Budget</h1>
        <p className="text-[13px] text-ink-3">Spending vs budget for {monthLabel}.</p>
      </header>

      {/* Summary: spent · donut · total budget */}
      <div className="rounded-xl border border-hair bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="tabular text-[22px] font-semibold text-ink">
              {fmtUsd(summary.totalSpent)}
            </div>
            <div className="text-[11px] text-ink-3">spent in {monthShort}</div>
          </div>
          <div className="h-24 w-24 shrink-0">
            <BudgetDonut
              groups={summary.groups}
              totalSpent={summary.totalSpent}
              showCenter={false}
              className="h-24 w-24"
            />
          </div>
          <div className="text-right">
            <div className="tabular text-[22px] font-semibold text-ink">
              {summary.totalBudget > 0 ? fmtUsd(summary.totalBudget) : "—"}
            </div>
            <div className="text-[11px] text-ink-3">total budget</div>
          </div>
        </div>
        {summary.incomeThisMonth > 0 && (
          <p className="mt-3 border-t border-hair pt-3 text-[12px] text-ink-3">
            Income this month:{" "}
            <span className="tabular text-good">{fmtUsd(summary.incomeThisMonth)}</span>
          </p>
        )}
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-3 px-1.5 text-[10px] uppercase tracking-wide text-ink-4">
        <span className="flex-1">Categories</span>
        <span className="w-16 text-right">Spent</span>
        <span className="hidden w-24 sm:block" />
        <span className="w-14 text-right">Budget</span>
      </div>

      {/* Category list */}
      <div className="space-y-0.5">
        {summary.groups.map((g: GroupCell) => {
          const open = expanded.has(g.id);
          const multi = g.leaves.length > 1;
          return (
            <div key={g.id}>
              <div className="flex items-center">
                <button
                  type="button"
                  aria-label={open ? "Collapse" : "Expand"}
                  onClick={() => toggle(g.id)}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded text-ink-3 hover:text-ink"
                >
                  <Chevron open={open} />
                </button>
                <button
                  type="button"
                  onClick={() => selectGroup(g)}
                  className={`${rowBase} ${selectedId === g.id ? selCls : hovCls}`}
                >
                  {multi ? (
                    <span
                      className="grid h-5 w-5 shrink-0 place-items-center rounded text-[10px] font-semibold text-white"
                      style={{ background: g.color }}
                    >
                      {g.leaves.length}
                    </span>
                  ) : (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: g.color }}
                    />
                  )}
                  <span className="flex-1 truncate text-[13px] font-medium text-ink">
                    {g.name}
                  </span>
                  <Amounts actual={g.actual} budget={g.budget} />
                </button>
              </div>

              {open && (
                <div className="space-y-0.5 pl-6">
                  {g.leaves.map((l: LeafCell) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setSelectedId(l.id)}
                      className={`${rowBase} ${selectedId === l.id ? selCls : hovCls}`}
                    >
                      <span className="w-5 shrink-0 text-center text-[13px]" aria-hidden>
                        {categoryEmoji(l.slug)}
                      </span>
                      <span className="flex-1 truncate text-[13px] text-ink-2">{l.name}</span>
                      <Amounts actual={l.actual} budget={l.budget} muted />
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {detailEl &&
        selectedId &&
        createPortal(
          <BudgetCategoryDetail
            categoryId={selectedId}
            editEnabled={editEnabled}
            onBudgetSaved={() => router.refresh()}
          />,
          detailEl,
        )}
    </div>
  );
}
