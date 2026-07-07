"use client";

import { useEffect, useState, type ReactElement } from "react";
import Link from "next/link";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import { CloseButton, Row, usePortalBasePath } from "@/components/portal/portal-detail-rail";
import { fmtDay, fmtUsd } from "@/lib/portal/format";

type MiniTxn = {
  id: string;
  date: string;
  name: string;
  merchantName: string | null;
  amount: string;
};

/** Recent activity for one account, fetched on open. 403 = advisor preview with transactions private. */
function RecentTransactions({ accountId }: { accountId: string }): ReactElement {
  const portalFetch = usePortalFetch();
  const [state, setState] = useState<"loading" | "ok" | "private" | "error">("loading");
  const [txns, setTxns] = useState<MiniTxn[]>([]);

  useEffect(() => {
    let live = true;
    // Back to the skeleton when the panel is reused for another account.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState("loading");
    portalFetch(`/api/portal/transactions?accountId=${accountId}&limit=10`)
      .then(async (r) => {
        if (!live) return;
        if (r.status === 403) return setState("private");
        if (!r.ok) return setState("error");
        const data = (await r.json()) as { transactions: MiniTxn[] };
        if (!live) return;
        setTxns(data.transactions ?? []);
        setState("ok");
      })
      .catch(() => {
        if (live) setState("error");
      });
    return () => {
      live = false;
    };
  }, [accountId, portalFetch]);

  if (state === "loading") {
    return <div className="h-16 animate-pulse rounded-md bg-card-2" />;
  }
  if (state === "private") {
    return <p className="text-[12px] text-ink-3">The client keeps transactions private.</p>;
  }
  if (state === "error") {
    return <p className="text-[12px] text-ink-3">Couldn&apos;t load recent activity.</p>;
  }
  if (txns.length === 0) {
    return <p className="text-[12px] text-ink-3">No transactions for this account yet.</p>;
  }
  return (
    <ul>
      {txns.map((t) => {
        const n = Number(t.amount);
        return (
          <li key={t.id} className="flex items-center gap-3 border-b border-hair/60 py-2 text-[13px] last:border-0">
            <span className="tabular w-12 shrink-0 text-[12px] text-ink-3">{fmtDay(t.date)}</span>
            <span className="min-w-0 flex-1 truncate text-ink-2">{t.merchantName ?? t.name}</span>
            <span className={`tabular shrink-0 ${n < 0 ? "text-good" : "text-ink"}`}>
              {n < 0 ? `+${fmtUsd(-n)}` : fmtUsd(n)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function AccountDetailPanel({
  account,
  onClose,
}: {
  account: {
    id: string;
    name: string;
    value: number;
    categoryLabel: string;
    subTypeLabel: string;
    last4: string | null;
    isPlaid: boolean;
    ownerLabel: string;
  };
  onClose: () => void;
}): ReactElement {
  const basePath = usePortalBasePath();
  return (
    <div className="space-y-4 rounded-xl border border-hair bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ink">
          {account.name}
          {account.last4 && <span className="tabular ml-1 text-[12px] text-ink-3">··{account.last4}</span>}
        </h2>
        <CloseButton onClose={onClose} />
      </div>
      <div className="tabular text-[22px] text-ink">{fmtUsd(account.value)}</div>
      <dl className="space-y-2 text-[13px]">
        <Row label="Category">{account.categoryLabel}</Row>
        <Row label="Type">{account.subTypeLabel}</Row>
        <Row label="Owner">{account.ownerLabel || "—"}</Row>
        {account.isPlaid && <Row label="Balance">Synced from your institution</Row>}
      </dl>
      <div className="space-y-1.5 border-t border-hair pt-3">
        <p className="text-[11px] uppercase tracking-wide text-ink-3">Recent activity</p>
        <RecentTransactions accountId={account.id} />
      </div>
      <Link
        href={`${basePath}/transactions?accountId=${account.id}`}
        className="block rounded-md border border-hair px-3 py-2 text-center text-[13px] text-ink-2 hover:bg-card-2"
      >
        View in Transactions →
      </Link>
    </div>
  );
}

export function DebtDetailPanel({
  debt,
  onClose,
}: {
  debt: {
    id: string;
    name: string;
    balance: number;
    typeLabel: string;
    aprPercentage: number | null;
    statementBalance: number | null;
    minimumPayment: number | null;
    nextPaymentDueDate: string | null;
    isPlaidLinked: boolean;
    ownerLabel: string;
  };
  onClose: () => void;
}): ReactElement {
  return (
    <div className="space-y-4 rounded-xl border border-hair bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ink">{debt.name}</h2>
        <CloseButton onClose={onClose} />
      </div>
      <div className="tabular text-[22px] text-ink">{fmtUsd(debt.balance)}</div>
      <dl className="space-y-2 text-[13px]">
        <Row label="Type">{debt.typeLabel}</Row>
        <Row label="Owner">{debt.ownerLabel || "Household"}</Row>
        {debt.aprPercentage != null && (
          <Row label="APR">
            <span className="tabular">{debt.aprPercentage.toFixed(2)}%</span>
          </Row>
        )}
        {debt.statementBalance != null && (
          <Row label="Statement balance">
            <span className="tabular">{fmtUsd(debt.statementBalance)}</span>
          </Row>
        )}
        {debt.minimumPayment != null && (
          <Row label="Minimum payment">
            <span className="tabular">{fmtUsd(debt.minimumPayment)}</span>
          </Row>
        )}
        {debt.nextPaymentDueDate != null && (
          <Row label="Next payment">
            <span className="tabular">{fmtDay(debt.nextPaymentDueDate)}</span>
          </Row>
        )}
        {debt.isPlaidLinked && <Row label="Balance">Synced from your institution</Row>}
      </dl>
    </div>
  );
}
