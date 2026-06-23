"use client";
import type { ReactElement } from "react";
import type { PortalTransactionDTO } from "@/components/portal/transactions-list";
import { CategoryPill } from "@/components/portal/category-pill";

const PROVENANCE: Record<PortalTransactionDTO["categorizedBy"], string> = {
  plaid: "Auto-categorized",
  rule: "Categorized by a rule",
  manual: "Set by you",
};

export function TransactionDetailPanel({
  txn,
  onClose,
  onCreateRule,
}: {
  txn: PortalTransactionDTO;
  onClose: () => void;
  onCreateRule: () => void;
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
      <dl className="space-y-2 text-[13px]">
        <div className="flex justify-between gap-4"><dt className="text-ink-3">Date</dt><dd className="tabular text-ink-2">{txn.date}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-ink-3">Description</dt><dd className="max-w-[60%] truncate text-ink-2">{txn.name}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-ink-3">Category</dt><dd><CategoryPill name={txn.categoryName} color={txn.categoryColor} /></dd></div>
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
    </div>
  );
}
