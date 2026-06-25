"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { createPortal } from "react-dom";
import { CategoryPill } from "@/components/portal/category-pill";
import { CategoryComboBox } from "@/components/portal/category-combobox";
import { TransactionDetailPanel } from "@/components/portal/transaction-detail-panel";
import { RuleCreateDialog } from "@/components/portal/rule-create-dialog";
import { RecurringCreateDialog } from "@/components/portal/recurring-create-dialog";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import { fmtAmount, formatDayHeader, badgeFor, type TxnType } from "@/components/portal/transaction-format";

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
  categorizedBy: "plaid" | "rule" | "manual" | "recurring";
  accountId: string | null;
  accountName: string | null;
  accountMask: string | null;
  type: TxnType;
  reviewed: boolean;
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
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [selected, setSelected] = useState<PortalTransactionDTO | null>(null);
  const [detailEl, setDetailEl] = useState<HTMLElement | null>(null);
  const [ruleSeed, setRuleSeed] = useState<PortalTransactionDTO | null>(null);
  const [recurringSeed, setRecurringSeed] = useState<PortalTransactionDTO | null>(null);
  const [recurrings, setRecurrings] = useState<{ id: string; name: string }[]>([]);
  // After a manual category change, offer to make it a standing rule for that name.
  const [ruleConfirm, setRuleConfirm] = useState<{ name: string; categoryId: string; categoryName: string } | null>(null);
  const [creatingRule, setCreatingRule] = useState(false);
  const portalFetch = usePortalFetch();

  useEffect(() => {
    void portalFetch("/api/portal/categories")
      .then((r) => (r.ok ? r.json() : { categories: [] }))
      .then((d: { categories: CategoryRow[] }) => setCategories(d.categories ?? []))
      .catch(() => setCategories([]));
  }, [portalFetch]);

  useEffect(() => {
    void portalFetch("/api/portal/recurrings")
      .then((r) => (r.ok ? r.json() : { recurrings: [] }))
      .then((d: { recurrings: { id: string; name: string }[] }) => setRecurrings(d.recurrings ?? []))
      .catch(() => setRecurrings([]));
  }, [portalFetch]);

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
      if (unreviewedOnly) params.set("reviewed", "false");
      try {
        const res = await portalFetch(`/api/portal/transactions?${params.toString()}`, { signal });
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
    [q, categoryId, windowKey, unreviewedOnly, portalFetch],
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
        const res = await portalFetch(`/api/portal/transactions/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) { setRows(prev); setError("Couldn't save that change."); }
      } catch {
        setRows(prev); setError("Couldn't save that change.");
      }
    },
    [rows, portalFetch],
  );

  // Pick a new category for a row: save it, then (for a real category) offer to
  // turn it into a standing rule for that merchant name.
  const handleCategoryPick = useCallback(
    (t: PortalTransactionDTO, catId: string | null) => {
      if (catId === t.categoryId) return;
      const picked = catId ? categories.find((c) => c.id === catId) : null;
      void patchTransaction(t.id, { categoryId: catId }, (row) => ({
        ...row,
        categoryId: catId,
        categoryName: picked?.name ?? null,
        categoryColor: picked?.color ?? null,
        categorizedBy: "manual",
      }));
      if (catId && picked) {
        setRuleConfirm({ name: t.merchantName ?? t.name, categoryId: catId, categoryName: picked.name });
      }
    },
    [categories, patchTransaction],
  );

  const createRuleFromConfirm = useCallback(async () => {
    if (!ruleConfirm) return;
    setCreatingRule(true);
    setError(null);
    try {
      const res = await portalFetch("/api/portal/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchType: "contains", pattern: ruleConfirm.name, categoryId: ruleConfirm.categoryId }),
      });
      if (!res.ok) { setError("Couldn't create the rule."); return; }
      setRuleConfirm(null);
      void load(0, true); // reflect retroactive recategorization of matching rows
    } catch {
      setError("Couldn't create the rule.");
    } finally {
      setCreatingRule(false);
    }
  }, [ruleConfirm, portalFetch, load]);

  async function linkRecurring(txnId: string, recurringId: string): Promise<void> {
    const res = await portalFetch(`/api/portal/transactions/${txnId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recurringTransactionId: recurringId }),
    });
    if (res.ok) { setSelected(null); void load(0, true); }
  }

  const changeType = useCallback(
    async (id: string, nextType: TxnType): Promise<void> => {
      const prev = rows;
      let prevSelected: PortalTransactionDTO | null = null;
      setSelected((s) => { prevSelected = s; return s && s.id === id ? { ...s, type: nextType, ...(nextType === "transfer" ? { categoryId: null, categoryName: null, categoryColor: null, categorizedBy: "manual" as const } : {}) } : s; });
      setRows((rs) =>
        rs.map((t) =>
          t.id === id
            ? {
                ...t,
                type: nextType,
                ...(nextType === "transfer"
                  ? { categoryId: null, categoryName: null, categoryColor: null, categorizedBy: "manual" as const }
                  : {}),
              }
            : t,
        ),
      );
      try {
        const res = await portalFetch(`/api/portal/transactions/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: nextType }),
        });
        if (!res.ok) { setRows(prev); setSelected(prevSelected); setError("Couldn't change the type."); }
      } catch {
        setRows(prev); setSelected(prevSelected); setError("Couldn't change the type.");
      }
    },
    [rows, portalFetch],
  );

  const toggleReviewed = useCallback(
    async (id: string, next: boolean): Promise<void> => {
      setError(null);
      const prev = rows;
      let prevSelected: PortalTransactionDTO | null = null;
      setSelected((s) => { prevSelected = s; return s && s.id === id ? { ...s, reviewed: next } : s; });
      setRows((rs) => rs.map((t) => (t.id === id ? { ...t, reviewed: next } : t)));
      try {
        const res = await portalFetch(`/api/portal/transactions/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reviewed: next }),
        });
        if (!res.ok) { setRows(prev); setSelected(prevSelected); setError("Couldn't save that change."); }
      } catch {
        setRows(prev); setSelected(prevSelected); setError("Couldn't save that change.");
      }
    },
    [rows, portalFetch],
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
        <button
          type="button"
          onClick={() => setUnreviewedOnly((v) => !v)}
          aria-pressed={unreviewedOnly}
          className={
            unreviewedOnly
              ? "rounded-md bg-accent/20 px-2 py-1 text-[12px] font-medium text-accent"
              : "rounded-md border border-hair px-2 py-1 text-[12px] text-ink-3 hover:bg-card"
          }
        >
          Unreviewed
        </button>
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
          <ul>
            {rows.map((t, i) => {
              const amt = fmtAmount(t.amount);
              const isRecurring = t.categorizedBy === "recurring";
              const badge = badgeFor(t.type, isRecurring);
              const showDay = i === 0 || rows[i - 1].date !== t.date;
              return (
                <li key={t.id}>
                  {showDay && (
                    <div className="bg-card-2 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-4">
                      {formatDayHeader(t.date)}
                    </div>
                  )}
                  <div className={`flex items-center gap-2 px-4 py-2.5 sm:gap-3${!showDay ? " border-t border-hair" : ""}`}>
                    <span
                      className={
                        badge
                          ? "flex h-5 w-5 shrink-0 items-center justify-center rounded bg-card-2 text-[10px] font-semibold text-ink-3"
                          : "h-5 w-5 shrink-0"
                      }
                      aria-hidden={badge ? undefined : true}
                    >
                      {badge}
                    </span>
                    <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setSelected(t)}>
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-ink">
                          {t.merchantName ?? t.name}
                        </span>
                        {t.accountName && (
                          <span className="truncate text-[12px] text-ink-4">{t.accountName}</span>
                        )}
                        {t.pending && <span className="text-[11px] text-warn">pending</span>}
                        {t.excluded && <span className="text-[11px] text-ink-4">excluded</span>}
                      </div>
                    </div>
                    {/* Category column — fixed width so every colored dot lines up.
                        When editable, the pill opens a compact searchable popover. */}
                    <div className="w-28 shrink-0 sm:w-44" onClick={(e) => e.stopPropagation()}>
                      {t.type === "transfer" ? (
                        <span className="text-[12px] text-ink-4">—</span>
                      ) : editEnabled ? (
                        <CategoryComboBox
                          categories={categories}
                          value={t.categoryId}
                          currentName={t.categoryName}
                          currentColor={t.categoryColor}
                          onPick={(catId) => handleCategoryPick(t, catId)}
                        />
                      ) : (
                        <CategoryPill name={t.categoryName} color={t.categoryColor} />
                      )}
                    </div>
                    <span className={`tabular w-24 shrink-0 text-right text-[14px] ${amt.cls}`}>{amt.text}</span>
                    <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                      {editEnabled ? (
                        <button
                          type="button"
                          aria-label={t.reviewed ? "Reviewed" : "Mark as reviewed"}
                          aria-pressed={t.reviewed}
                          onClick={() => void toggleReviewed(t.id, !t.reviewed)}
                          className={
                            t.reviewed
                              ? "flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-accent"
                              : "flex h-6 w-6 items-center justify-center rounded-full border border-hair text-ink-4 hover:border-accent hover:text-accent"
                          }
                        >
                          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      ) : t.reviewed ? (
                        <span aria-label="Reviewed" className="flex h-6 w-6 items-center justify-center text-accent">
                          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                      ) : null}
                    </span>
                    {editEnabled && (
                      <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() =>
                            void patchTransaction(t.id, { excluded: !t.excluded }, (row) => ({ ...row, excluded: !row.excluded }))
                          }
                          className="rounded-md border border-hair px-2 py-1 text-[11px] text-ink-3 hover:bg-card"
                        >
                          {t.excluded ? "Include" : "Exclude"}
                        </button>
                      </span>
                    )}
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
          // Desktop: renders inline in the side column. Below `lg`: a
          // full-screen overlay anchoring the panel to the bottom as a sheet,
          // with a tap-to-dismiss scrim behind it.
          <div className="max-lg:fixed max-lg:inset-0 max-lg:z-40 max-lg:flex max-lg:flex-col max-lg:justify-end">
            <button
              type="button"
              aria-label="Close transaction details"
              onClick={() => setSelected(null)}
              className="absolute inset-0 -z-10 bg-black/50 lg:hidden"
            />
            <TransactionDetailPanel
              txn={selected}
              editEnabled={editEnabled}
              onChangeType={(nt: TxnType) => { if (selected) void changeType(selected.id, nt); }}
              onClose={() => setSelected(null)}
              onCreateRule={() => setRuleSeed(selected)}
              onCreateRecurring={() => setRecurringSeed(selected)}
              recurrings={recurrings}
              onLinkRecurring={(rid) => { if (selected) void linkRecurring(selected.id, rid); }}
              onMarkReviewed={(r) => { if (selected) void toggleReviewed(selected.id, r); }}
            />
          </div>,
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
      {recurringSeed && (
        <RecurringCreateDialog
          seed={{
            name: recurringSeed.merchantName ?? recurringSeed.name,
            merchantName: recurringSeed.merchantName,
            categoryId: recurringSeed.categoryId,
            amount: Number(recurringSeed.amount),
          }}
          categories={categories}
          onClose={() => setRecurringSeed(null)}
          onCreated={() => { setRecurringSeed(null); setSelected(null); void load(0, true); }}
        />
      )}
      {ruleConfirm && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="flex max-w-full items-center gap-3 rounded-xl border border-hair bg-card-2 px-4 py-3 shadow-lg">
            <span className="text-[13px] text-ink-2">
              Always categorize{" "}
              <span className="font-medium text-ink">{ruleConfirm.name}</span> as{" "}
              <span className="font-medium text-ink">{ruleConfirm.categoryName}</span>?
            </span>
            <button
              type="button"
              onClick={() => setRuleConfirm(null)}
              className="shrink-0 rounded-md px-2 py-1 text-[12px] text-ink-3 hover:bg-card"
            >
              Not now
            </button>
            <button
              type="button"
              disabled={creatingRule}
              onClick={() => void createRuleFromConfirm()}
              className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-on hover:bg-accent/90 disabled:opacity-50"
            >
              {creatingRule ? "Creating…" : "Create rule"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
