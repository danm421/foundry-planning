"use client";
import type { ReactElement } from "react";
import type { PortalTransactionDTO } from "@/components/portal/transactions-list";
import type { TxnType } from "@/components/portal/transaction-format";
import { CategoryPill } from "@/components/portal/category-pill";

const PROVENANCE: Record<PortalTransactionDTO["categorizedBy"], string> = {
  plaid: "Auto-categorized",
  rule: "Categorized by a rule",
  manual: "Set by you",
  recurring: "From a recurring",
};

export function TransactionDetailPanel({
  txn,
  onClose,
  onCreateRule,
  onCreateRecurring,
  recurrings,
  onLinkRecurring,
  editEnabled = false,
  onChangeType,
}: {
  txn: PortalTransactionDTO;
  onClose: () => void;
  onCreateRule: () => void;
  onCreateRecurring: () => void;
  recurrings: { id: string; name: string }[];
  onLinkRecurring: (recurringId: string) => void;
  editEnabled?: boolean;
  onChangeType?: (type: TxnType) => void;
}): ReactElement {
  const n = Number(txn.amount);
  const abs = Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return (
    <div className="space-y-4 rounded-xl border border-hair bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ink">{txn.merchantName ?? txn.name}</h2>
        <button type="button" onClick={onClose} className="text-[12px] text-ink-3 hover:text-ink">Close</button>
      </div>
      <div className={`tabular text-[22px] ${n < 0 ? "text-good" : "text-ink"}`}>
        {n < 0 ? `+${abs}` : abs}
      </div>
      {editEnabled && onChangeType && (
        <div className="flex gap-1 rounded-lg bg-card-2 p-1">
          {(["expense", "income", "transfer"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onChangeType(opt)}
              className={
                txn.type === opt
                  ? "flex-1 rounded-md bg-accent/20 px-2 py-1 text-[12px] font-medium capitalize text-accent"
                  : "flex-1 rounded-md px-2 py-1 text-[12px] capitalize text-ink-3 hover:bg-card"
              }
            >
              {opt.charAt(0).toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>
      )}
      <dl className="space-y-2 text-[13px]">
        {txn.accountName && (
          <div className="flex justify-between gap-4">
            <dt className="text-ink-3">Account</dt>
            <dd className="max-w-[60%] truncate text-ink-2">
              {txn.accountName}
              {txn.accountMask && <span className="tabular text-ink-3"> ••{txn.accountMask}</span>}
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-4"><dt className="text-ink-3">Date</dt><dd className="tabular text-ink-2">{txn.date}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-ink-3">Description</dt><dd className="max-w-[60%] truncate text-ink-2">{txn.name}</dd></div>
        {txn.type !== "transfer" && (
          <div className="flex justify-between gap-4"><dt className="text-ink-3">Category</dt><dd><CategoryPill name={txn.categoryName} color={txn.categoryColor} /></dd></div>
        )}
        <div className="flex justify-between gap-4"><dt className="text-ink-3">Source</dt><dd className="text-ink-2">{PROVENANCE[txn.categorizedBy]}</dd></div>
        {txn.pending && <div className="flex justify-between gap-4"><dt className="text-ink-3">Status</dt><dd className="text-warn">Pending</dd></div>}
      </dl>
      <button
        type="button"
        onClick={onCreateRule}
        className="w-full rounded-md border border-hair px-3 py-1.5 text-[13px] text-ink-2 hover:bg-card-2"
      >
        Create rule from this merchant
      </button>
      <button
        type="button"
        onClick={onCreateRecurring}
        className="w-full rounded-md border border-hair px-3 py-1.5 text-[13px] text-ink-2 hover:bg-card-2"
      >
        Create recurring from this
      </button>
      {recurrings.length > 0 && (
        <label className="block space-y-1">
          <span className="text-[12px] text-ink-3">Link to a recurring</span>
          <select
            defaultValue=""
            onChange={(e) => { if (e.target.value) onLinkRecurring(e.target.value); }}
            className="w-full rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink-2"
          >
            <option value="" disabled>Pick a recurring…</option>
            {recurrings.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
