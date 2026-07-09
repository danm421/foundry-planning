"use client";
// Right-side slide-over showing one transaction's full details — the same
// TransactionDetailPanel the Transactions tab portals into the rail. Pages
// whose rail is already occupied (Budget keeps the category panel there) host
// the detail in this overlay drawer instead. Follows the crm-task-side-panel
// overlay idiom: fixed scrim + right panel + ref-counted body scroll lock.

import { useCallback, useEffect, useState, type ReactElement } from "react";
import { TransactionDetailPanel } from "@/components/portal/transaction-detail-panel";
import { RuleCreateDialog } from "@/components/portal/rule-create-dialog";
import { RecurringCreateDialog } from "@/components/portal/recurring-create-dialog";
import { ManualTransactionDialog } from "@/components/portal/manual-transaction-dialog";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import type { PortalTransactionDTO } from "@/components/portal/transactions-list";
import type { TxnType } from "@/components/portal/transaction-format";

type CategoryRow = {
  id: string;
  name: string;
  kind: "group" | "category";
  parentId: string | null;
  color: string | null;
};

export function TransactionDrawer({
  txnId,
  categories,
  editEnabled,
  onClose,
  onChanged,
}: {
  txnId: string;
  categories: CategoryRow[];
  editEnabled: boolean;
  onClose: () => void;
  /** Fired after any successful mutation so the host view can refresh. */
  onChanged: () => void;
}): ReactElement {
  const portalFetch = usePortalFetch();
  const [txn, setTxn] = useState<PortalTransactionDTO | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recurrings, setRecurrings] = useState<{ id: string; name: string }[]>([]);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  useBodyScrollLock(true);

  const loadTxn = useCallback(async (): Promise<void> => {
    const res = await portalFetch(`/api/portal/transactions/${txnId}`);
    if (!res.ok) throw new Error("load failed");
    const json = (await res.json()) as { transaction: PortalTransactionDTO };
    setTxn(json.transaction);
  }, [portalFetch, txnId]);

  // Hosts render this drawer with key={txnId}, so a different transaction
  // remounts it fresh — no stale-state reset needed here.
  useEffect(() => {
    let cancelled = false;
    portalFetch(`/api/portal/transactions/${txnId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("load failed");
        const json = (await res.json()) as { transaction: PortalTransactionDTO };
        if (!cancelled) setTxn(json.transaction);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [txnId, portalFetch]);

  useEffect(() => {
    void portalFetch("/api/portal/recurrings")
      .then((r) => (r.ok ? r.json() : { recurrings: [] }))
      .then((d: { recurrings: { id: string; name: string }[] }) =>
        setRecurrings(d.recurrings ?? []),
      )
      .catch(() => setRecurrings([]));
  }, [portalFetch]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const patch = useCallback(
    async (body: Record<string, unknown>, failMsg: string): Promise<boolean> => {
      setError(null);
      try {
        const res = await portalFetch(`/api/portal/transactions/${txnId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          setError(failMsg);
          return false;
        }
        onChanged();
        return true;
      } catch {
        setError(failMsg);
        return false;
      }
    },
    [portalFetch, txnId, onChanged],
  );

  async function changeType(nextType: TxnType): Promise<void> {
    const prev = txn;
    setTxn((t) =>
      t
        ? {
            ...t,
            type: nextType,
            ...(nextType === "transfer"
              ? {
                  categoryId: null,
                  categoryName: null,
                  categoryColor: null,
                  categorizedBy: "manual" as const,
                }
              : {}),
          }
        : t,
    );
    if (!(await patch({ type: nextType }, "Couldn't change the type."))) setTxn(prev);
  }

  async function markReviewed(next: boolean): Promise<void> {
    const prev = txn;
    setTxn((t) => (t ? { ...t, reviewed: next } : t));
    if (!(await patch({ reviewed: next }, "Couldn't save that change."))) setTxn(prev);
  }

  async function linkRecurring(recurringId: string): Promise<void> {
    if (await patch({ recurringTransactionId: recurringId }, "Couldn't link the recurring.")) {
      onClose();
    }
  }

  async function deleteTxn(): Promise<void> {
    setError(null);
    try {
      const res = await portalFetch(`/api/portal/transactions/${txnId}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Couldn't delete that transaction.");
        return;
      }
      onChanged();
      onClose();
    } catch {
      setError("Couldn't delete that transaction.");
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="Close transaction details"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Transaction details"
        className="relative z-10 h-full w-full overflow-y-auto border-l border-hair bg-paper p-4 sm:w-[480px]"
      >
        {loadError ? (
          <div className="rounded-xl border border-hair bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[13px] text-ink-3">Couldn&apos;t load this transaction.</p>
              <button
                type="button"
                onClick={onClose}
                className="text-[12px] text-ink-3 hover:text-ink"
              >
                Close
              </button>
            </div>
          </div>
        ) : !txn ? (
          <div className="space-y-4 rounded-xl border border-hair bg-card p-5">
            <div className="h-6 w-40 animate-pulse rounded bg-card-2" />
            <div className="h-8 w-28 animate-pulse rounded bg-card-2" />
            <div className="h-32 animate-pulse rounded-lg bg-card-2" />
          </div>
        ) : (
          <div className="space-y-3">
            {error && <p className="text-[12px] text-crit">{error}</p>}
            <TransactionDetailPanel
              txn={txn}
              editEnabled={editEnabled}
              onChangeType={(nt: TxnType) => void changeType(nt)}
              onClose={onClose}
              onCreateRule={() => setRuleOpen(true)}
              onCreateRecurring={() => setRecurringOpen(true)}
              recurrings={recurrings}
              onLinkRecurring={(rid) => void linkRecurring(rid)}
              onMarkReviewed={(r) => void markReviewed(r)}
              onEdit={txn.source === "manual" ? () => setEditOpen(true) : undefined}
              onDelete={txn.source === "manual" ? () => void deleteTxn() : undefined}
            />
          </div>
        )}
      </div>
      {ruleOpen && txn && (
        <RuleCreateDialog
          seed={{ merchantName: txn.merchantName, name: txn.name, categoryId: txn.categoryId }}
          categories={categories}
          onClose={() => setRuleOpen(false)}
          onCreated={() => {
            setRuleOpen(false);
            onChanged();
            void loadTxn().catch(() => setLoadError(true));
          }}
        />
      )}
      {recurringOpen && txn && (
        <RecurringCreateDialog
          seed={{
            name: txn.merchantName ?? txn.name,
            merchantName: txn.merchantName,
            categoryId: txn.categoryId,
            amount: Number(txn.amount),
          }}
          categories={categories}
          onClose={() => setRecurringOpen(false)}
          onCreated={() => {
            setRecurringOpen(false);
            onChanged();
            void loadTxn().catch(() => setLoadError(true));
          }}
        />
      )}
      {editOpen && txn && (
        <ManualTransactionDialog
          txn={txn}
          categories={categories}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            onChanged();
            void loadTxn().catch(() => setLoadError(true));
          }}
        />
      )}
    </div>
  );
}
