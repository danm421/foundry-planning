"use client";
// Rail panels for the Dashboard drill-downs. DashboardGrid portals this into
// the shared #portal-detail aside (bottom sheet < lg) — the same surface the
// Transactions / Recurrings / Budget / Accounts pages use.
import Link from "next/link";
import { useEffect, useState, type ReactElement } from "react";
import { fmtDay, fmtUsd } from "@/lib/portal/format";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import {
  CloseButton,
  Row,
  usePortalBasePath,
} from "@/components/portal/portal-detail-rail";
import { BudgetCategoryDetail } from "@/components/portal/budget-category-detail";
import { RecurringDetailPanel } from "@/components/portal/recurring-detail-panel";
import { CategoryComboBox } from "@/components/portal/category-combobox";
import { CategoryPill } from "@/components/portal/category-pill";
import type {
  NetWorthLine,
  PortalDashboardDTO,
  ReviewTxn,
} from "@/lib/portal/load-dashboard";

export type DashboardDetailPayload =
  | { kind: "category"; categoryId: string; name: string }
  | { kind: "recurring"; id: string }
  | { kind: "transaction"; id: string }
  | { kind: "networth" }
  | { kind: "spending" };

type CategoryRow = {
  id: string;
  name: string;
  kind: "group" | "category";
  parentId: string | null;
  color: string | null;
};

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function FooterLink({ href, label }: { href: string; label: string }): ReactElement {
  return (
    <Link
      href={href}
      className="block rounded-md border border-hair px-3 py-2 text-center text-[13px] text-ink-2 hover:bg-card-2"
    >
      {label} →
    </Link>
  );
}

/**
 * To-review drill-down: the transaction facts plus, when editing is enabled,
 * a category picker and "Mark as reviewed" — the review queue is clearable
 * right from the dashboard.
 */
function ReviewTransactionPanel({
  txn,
  editEnabled,
  onMarkReviewed,
  onClose,
}: {
  txn: ReviewTxn;
  editEnabled: boolean;
  onMarkReviewed: () => void;
  onClose: () => void;
}): ReactElement {
  const portalFetch = usePortalFetch();
  const basePath = usePortalBasePath();
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [cat, setCat] = useState({
    id: txn.categoryId,
    name: txn.categoryName,
    color: txn.categoryColor,
  });
  const [error, setError] = useState(false);

  // Categories load on demand — only an editable panel needs the picker.
  useEffect(() => {
    if (!editEnabled) return;
    let live = true;
    void portalFetch("/api/portal/categories")
      .then((r) => (r.ok ? r.json() : { categories: [] }))
      .then((d: { categories: CategoryRow[] }) => {
        if (live) setCategories(d.categories ?? []);
      })
      .catch(() => {
        if (live) setCategories([]);
      });
    return () => {
      live = false;
    };
  }, [editEnabled, portalFetch]);

  async function pickCategory(catId: string | null): Promise<void> {
    if (catId === cat.id) return;
    setError(false);
    const prev = cat;
    const picked = catId ? categories.find((c) => c.id === catId) : null;
    setCat({ id: catId, name: picked?.name ?? null, color: picked?.color ?? null });
    try {
      const res = await portalFetch(`/api/portal/transactions/${txn.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categoryId: catId }),
      });
      if (!res.ok) {
        setCat(prev);
        setError(true);
      }
    } catch {
      setCat(prev);
      setError(true);
    }
  }

  const n = txn.amount;
  return (
    <div className="space-y-4 rounded-xl border border-hair bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ink">{txn.merchantName ?? txn.name}</h2>
        <CloseButton onClose={onClose} />
      </div>
      <div className={`tabular text-[22px] ${n < 0 ? "text-good" : "text-ink"}`}>
        {n < 0 ? `+${fmtUsd(-n)}` : fmtUsd(n)}
      </div>
      <dl className="space-y-2 text-[13px]">
        <Row label="Date">{fmtDay(txn.date)}</Row>
        <Row label="Account">{txn.accountName ?? "—"}</Row>
        <Row label="Description">{txn.name}</Row>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-ink-3">Category</dt>
          <dd className="w-44">
            {editEnabled ? (
              <CategoryComboBox
                categories={categories}
                value={cat.id}
                currentName={cat.name}
                currentColor={cat.color}
                onPick={(id) => void pickCategory(id)}
              />
            ) : (
              <CategoryPill name={cat.name} color={cat.color} />
            )}
          </dd>
        </div>
      </dl>
      {error && <p className="text-[12px] text-crit">Couldn&apos;t save that change.</p>}
      {editEnabled && (
        <button
          type="button"
          onClick={onMarkReviewed}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-hair px-3 py-1.5 text-[13px] text-ink-2 hover:bg-card-2"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Mark as reviewed
        </button>
      )}
      <FooterLink href={`${basePath}/transactions`} label="Open in Transactions" />
    </div>
  );
}

function BreakdownSection({
  title,
  total,
  lines,
}: {
  title: string;
  total: number;
  lines: NetWorthLine[];
}): ReactElement {
  return (
    <div className="space-y-1.5 border-t border-hair pt-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] uppercase tracking-wide text-ink-3">{title}</p>
        <span className="tabular text-[12px] text-ink-3">{fmtUsd(total)}</span>
      </div>
      {lines.length === 0 ? (
        <p className="text-[12px] text-ink-3">Nothing here yet.</p>
      ) : (
        <ul>
          {lines.map((l) => (
            <li
              key={l.id}
              className="flex items-center justify-between gap-3 border-b border-hair/60 py-2 text-[13px] last:border-0"
            >
              <span className="min-w-0 flex-1 truncate text-ink-2">{l.name}</span>
              <span className="tabular shrink-0 text-ink">{fmtUsd(l.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Net-worth drill-down: every visible account and debt behind the headline. */
function NetWorthPanel({
  netWorth,
  onClose,
}: {
  netWorth: PortalDashboardDTO["netWorth"];
  onClose: () => void;
}): ReactElement {
  const basePath = usePortalBasePath();
  return (
    <div className="space-y-4 rounded-xl border border-hair bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ink">Net worth</h2>
        <CloseButton onClose={onClose} />
      </div>
      <div className="tabular text-[22px] text-ink">{fmtUsd(netWorth.netWorth)}</div>
      <BreakdownSection title="Assets" total={netWorth.assets} lines={netWorth.accounts} />
      <BreakdownSection title="Debts" total={netWorth.debt} lines={netWorth.debts} />
      <FooterLink href={`${basePath}/accounts`} label="Open in Accounts" />
    </div>
  );
}

/** Spending drill-down: per-group spent vs budget; a group opens its category detail. */
function SpendingGroupsPanel({
  spending,
  onOpenCategory,
  onClose,
}: {
  spending: PortalDashboardDTO["spending"];
  onOpenCategory: (categoryId: string, name: string) => void;
  onClose: () => void;
}): ReactElement {
  const basePath = usePortalBasePath();
  return (
    <div className="space-y-4 rounded-xl border border-hair bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ink">Monthly spending</h2>
        <CloseButton onClose={onClose} />
      </div>
      <div className="tabular text-[22px] text-ink">
        {fmtUsd(spending.spent)}{" "}
        <span className="text-[13px] font-normal text-ink-3">
          spent in {monthLabel(spending.month)}
        </span>
      </div>
      {spending.groups.length === 0 ? (
        <p className="text-[13px] text-ink-3">No spending yet this month.</p>
      ) : (
        <ul className="space-y-3">
          {spending.groups.map((g) => {
            const over = g.budget != null && g.spent > g.budget;
            const pct = g.budget && g.budget > 0 ? Math.min(100, (g.spent / g.budget) * 100) : 0;
            return (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => onOpenCategory(g.id, g.name)}
                  className="w-full rounded-md px-2 py-1 text-left hover:bg-card-2"
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-2 text-[13px] text-ink-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: g.color }} />
                      {g.name}
                    </span>
                    <span className="tabular text-[13px] text-ink">
                      {fmtUsd(g.spent)}
                      {g.budget != null && <span className="text-ink-3"> / {fmtUsd(g.budget)}</span>}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-2">
                    <div
                      className={`h-full ${over ? "bg-crit" : "bg-good"}`}
                      style={{ width: `${g.budget ? pct : 100}%` }}
                    />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <FooterLink href={`${basePath}/budget`} label="Open in Budget" />
    </div>
  );
}

function EmptyPanel({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-hair bg-card p-5">
      <p className="text-[13px] text-ink-3">No detail available.</p>
      <CloseButton onClose={onClose} />
    </div>
  );
}

export function DashboardDetailPanel({
  payload,
  dto,
  reviewItems,
  editEnabled,
  onOpenCategory,
  onMarkReviewed,
  onClose,
}: {
  payload: DashboardDetailPayload;
  dto: PortalDashboardDTO;
  /** Live to-review queue (owned by DashboardGrid so tile + panel stay in sync). */
  reviewItems: ReviewTxn[];
  editEnabled: boolean;
  onOpenCategory: (categoryId: string, name: string) => void;
  onMarkReviewed: (id: string) => void;
  onClose: () => void;
}): ReactElement {
  const basePath = usePortalBasePath();

  if (payload.kind === "category") {
    return (
      <div className="space-y-3">
        <div className="flex justify-end">
          <CloseButton onClose={onClose} />
        </div>
        <BudgetCategoryDetail
          categoryId={payload.categoryId}
          editEnabled={false}
          onBudgetSaved={() => {}}
        />
        <FooterLink href={`${basePath}/budget`} label="Open in Budget" />
      </div>
    );
  }

  if (payload.kind === "recurring") {
    const r = dto.recurringRows.find((x) => x.id === payload.id);
    return (
      <div className="space-y-3">
        {r ? (
          <RecurringDetailPanel
            r={r}
            editEnabled={false}
            onClose={onClose}
            onEdit={() => {}}
            onDelete={() => {}}
          />
        ) : (
          <EmptyPanel onClose={onClose} />
        )}
        <FooterLink href={`${basePath}/recurrings`} label="Open in Recurrings" />
      </div>
    );
  }

  if (payload.kind === "transaction") {
    const t = reviewItems.find((x) => x.id === payload.id);
    if (!t) return <EmptyPanel onClose={onClose} />;
    return (
      <ReviewTransactionPanel
        // Keyed so category state re-seeds when the user jumps straight from
        // one to-review row to another (the panel doesn't unmount in between).
        key={t.id}
        txn={t}
        editEnabled={editEnabled}
        onMarkReviewed={() => onMarkReviewed(t.id)}
        onClose={onClose}
      />
    );
  }

  if (payload.kind === "networth") {
    return <NetWorthPanel netWorth={dto.netWorth} onClose={onClose} />;
  }

  return (
    <SpendingGroupsPanel spending={dto.spending} onOpenCategory={onOpenCategory} onClose={onClose} />
  );
}
