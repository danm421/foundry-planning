"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { createPortal } from "react-dom";
import { CategoryPill } from "@/components/portal/category-pill";
import { CategoryPicker } from "@/components/portal/category-picker";
import { TransactionDetailPanel } from "@/components/portal/transaction-detail-panel";
import { RuleCreateDialog } from "@/components/portal/rule-create-dialog";

export type PortalTransactionDTO = {
  id: string;
  date: string;
  name: string;
  merchantName: string | null;
  amount: string;
  pending: boolean;
  excluded: boolean;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  categorizedBy: "plaid" | "rule" | "manual";
  accountId: string | null;
};
type CategoryRow = { id: string; name: string; kind: "group" | "category"; parentId: string | null; color: string | null };

const WINDOWS = [
  { key: "1M", label: "1M", days: 30 },
  { key: "3M", label: "3M", days: 90 },
  { key: "YTD", label: "YTD", days: 0 },
  { key: "1Y", label: "1Y", days: 365 },
  { key: "ALL", label: "All", days: -1 },
] as const;
const PAGE = 50;

function fmtAmount(amount: string): { text: string; cls: string } {
  const n = Number(amount);
  // Plaid sign: positive = money out (spend). Show spend as plain, income as good.
  const abs = Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return n < 0 ? { text: `+${abs}`, cls: "text-good" } : { text: abs, cls: "text-ink" };
}

function windowFrom(days: number): string | undefined {
  if (days < 0) return undefined;
  const now = new Date();
  if (days === 0) return `${now.getFullYear()}-01-01`;
  const d = new Date(now.getTime() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

export default function TransactionsList({
  clientId,
  editEnabled,
}: {
  clientId: string;
  editEnabled: boolean;
}): ReactElement {
  void clientId;

  const [rows, setRows] = useState<PortalTransactionDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [windowKey, setWindowKey] = useState<(typeof WINDOWS)[number]["key"]>("3M");
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [selected, setSelected] = useState<PortalTransactionDTO | null>(null);
  const [detailEl, setDetailEl] = useState<HTMLElement | null>(null);
  const [ruleSeed, setRuleSeed] = useState<PortalTransactionDTO | null>(null);

  useEffect(() => {
    void fetch("/api/portal/categories")
      .then((r) => (r.ok ? r.json() : { categories: [] }))
      .then((d: { categories: CategoryRow[] }) => setCategories(d.categories ?? []))
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => { setDetailEl(document.getElementById("portal-detail")); }, []);

  const load = useCallback(
    async (nextOffset: number, replace: boolean, signal?: AbortSignal) => {
      setLoading(true);
      const days = WINDOWS.find((w) => w.key === windowKey)!.days;
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(nextOffset) });
      const from = windowFrom(days);
      if (from) params.set("from", from);
      if (q.trim()) params.set("q", q.trim());
      if (categoryId) params.set("categoryId", categoryId);
      try {
        const res = await fetch(`/api/portal/transactions?${params.toString()}`, { signal });
        if (!res.ok) return;
        const data = (await res.json()) as { transactions: PortalTransactionDTO[]; total: number };
        setTotal(data.total);
        setOffset(nextOffset);
        setRows((prev) => (replace ? data.transactions : [...prev, ...data.transactions]));
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
      } finally {
        setLoading(false);
      }
    },
    [q, categoryId, windowKey],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(0, true, controller.signal);
    return () => controller.abort();
  }, [load]);

  const patchTransaction = useCallback(
    async (
      id: string,
      patch: { categoryId?: string | null; excluded?: boolean },
      optimistic: (t: PortalTransactionDTO) => PortalTransactionDTO,
    ) => {
      setError(null);
      const prev = rows;
      setRows((rs) => rs.map((t) => (t.id === id ? optimistic(t) : t)));
      try {
        const res = await fetch(`/api/portal/transactions/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) { setRows(prev); setError("Couldn't save that change."); }
      } catch {
        setRows(prev); setError("Couldn't save that change.");
      }
    },
    [rows],
  );

  const leaves = categories.filter((c) => c.kind === "category");
  const hasMore = rows.length < total;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search merchant…"
          className="rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink placeholder:text-ink-4"
        />
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink-2"
        >
          <option value="">All categories</option>
          {leaves.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              onClick={() => setWindowKey(w.key)}
              className={
                w.key === windowKey
                  ? "rounded-md bg-accent/20 px-2 py-1 text-[12px] font-medium text-accent"
                  : "rounded-md px-2 py-1 text-[12px] text-ink-3 hover:bg-card"
              }
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-[12px] text-crit">{error}</p>}

      <div className="overflow-hidden rounded-xl border border-hair bg-card">
        {rows.length === 0 && !loading ? (
          <div className="p-6 text-center text-[13px] text-ink-3">No transactions in this window.</div>
        ) : (
          <ul className="divide-y divide-hair">
            {rows.map((t) => {
              const amt = fmtAmount(t.amount);
              return (
                <li key={t.id} className="flex items-center justify-between gap-4 p-4">
                  <div className="min-w-0 cursor-pointer" onClick={() => setSelected(t)}>
                    <div className="truncate text-[13px] font-medium text-ink">
                      {t.merchantName ?? t.name}
                      {t.pending && <span className="ml-2 text-[11px] text-warn">pending</span>}
                      {t.excluded && <span className="ml-2 text-[11px] text-ink-4">excluded</span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="tabular text-[12px] text-ink-3">{t.date}</span>
                      <span onClick={(e) => e.stopPropagation()}>
                        {editEnabled ? (
                          <CategoryPicker
                            categories={categories}
                            value={t.categoryId}
                            onPick={(catId) =>
                              void patchTransaction(
                                t.id,
                                { categoryId: catId },
                                (row) => {
                                  const picked = categories.find((c) => c.id === catId);
                                  return { ...row, categoryId: catId, categoryName: picked?.name ?? null, categoryColor: picked?.color ?? null, categorizedBy: "manual" };
                                },
                              )
                            }
                          />
                        ) : (
                          <CategoryPill name={t.categoryName} color={t.categoryColor} />
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`tabular text-[14px] ${amt.cls}`}>{amt.text}</span>
                    <span onClick={(e) => e.stopPropagation()}>
                      {editEnabled && (
                        <button
                          type="button"
                          onClick={() =>
                            void patchTransaction(t.id, { excluded: !t.excluded }, (row) => ({ ...row, excluded: !row.excluded }))
                          }
                          className="rounded-md border border-hair px-2 py-1 text-[11px] text-ink-3 hover:bg-card"
                        >
                          {t.excluded ? "Include" : "Exclude"}
                        </button>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="tabular text-[12px] text-ink-4">{total} transactions</span>
        {hasMore && (
          <button
            type="button"
            disabled={loading}
            onClick={() => void load(offset + PAGE, false)}
            className="rounded-md border border-hair px-3 py-1.5 text-[13px] text-ink-2 hover:bg-card disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </div>

      {selected && detailEl &&
        createPortal(
          <TransactionDetailPanel
            txn={selected}
            onClose={() => setSelected(null)}
            onCreateRule={() => setRuleSeed(selected)}
          />,
          detailEl,
        )}
      {ruleSeed && (
        <RuleCreateDialog
          seed={{ merchantName: ruleSeed.merchantName, name: ruleSeed.name, categoryId: ruleSeed.categoryId }}
          categories={categories}
          onClose={() => setRuleSeed(null)}
          onCreated={() => { setRuleSeed(null); setSelected(null); void load(0, true); }}
        />
      )}
    </div>
  );
}
