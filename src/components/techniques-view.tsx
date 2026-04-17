"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TransferRow {
  id: string;
  name: string;
  sourceAccountId: string;
  targetAccountId: string;
  amount: string;
  mode: "one_time" | "recurring" | "scheduled";
  startYear: number;
  startYearRef: string | null;
  endYear: number | null;
  endYearRef: string | null;
  growthRate: string;
  schedules: { id: string; year: number; amount: string }[];
}

export interface AssetTransactionRow {
  id: string;
  name: string;
  type: "buy" | "sell";
  year: number;
  accountId: string | null;
  overrideSaleValue: string | null;
  overrideBasis: string | null;
  transactionCostPct: string | null;
  transactionCostFlat: string | null;
  proceedsAccountId: string | null;
  assetName: string | null;
  assetCategory: string | null;
  assetSubType: string | null;
  purchasePrice: string | null;
  growthRate: string | null;
  basis: string | null;
  fundingAccountId: string | null;
  mortgageAmount: string | null;
  mortgageRate: string | null;
  mortgageTermMonths: number | null;
}

export interface AccountOption {
  id: string;
  name: string;
  category: string;
  subType: string;
}

export interface LiabilityOption {
  id: string;
  name: string;
  linkedPropertyId: string | null;
  balance: string;
}

interface TechniquesViewProps {
  clientId: string;
  transfers: TransferRow[];
  assetTransactions: AssetTransactionRow[];
  accounts: AccountOption[];
  liabilities: LiabilityOption[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(num);
}

const ROTH_SUB_TYPES = new Set(["roth_ira", "roth_401k"]);
const TAX_DEFERRED_SUB_TYPES = new Set(["traditional_ira", "401k"]);

type TaxClassification =
  | "roth_conversion"
  | "tax_free_rollover"
  | "distribution"
  | "liquidation"
  | "transfer";

function classifyTransfer(
  source: AccountOption | undefined,
  target: AccountOption | undefined,
): TaxClassification {
  if (!source || !target) return "transfer";

  const srcCat = source.category;
  const tgtCat = target.category;
  const srcSub = source.subType;
  const tgtSub = target.subType;

  if (srcCat === "retirement" && tgtCat === "retirement") {
    if (TAX_DEFERRED_SUB_TYPES.has(srcSub) && ROTH_SUB_TYPES.has(tgtSub)) {
      return "roth_conversion";
    }
    return "tax_free_rollover";
  }

  if (srcCat === "retirement" && tgtCat !== "retirement") {
    return "distribution";
  }

  if (srcCat === "taxable" || srcCat === "cash") {
    return "liquidation";
  }

  return "transfer";
}

const CLASSIFICATION_LABELS: Record<TaxClassification, string> = {
  roth_conversion: "Roth Conversion",
  tax_free_rollover: "Tax-Free Rollover",
  distribution: "Distribution",
  liquidation: "Liquidation",
  transfer: "Transfer",
};

const CLASSIFICATION_STYLES: Record<TaxClassification, string> = {
  roth_conversion: "bg-amber-900/40 text-amber-300 border border-amber-700/50",
  tax_free_rollover: "bg-green-900/40 text-green-300 border border-green-700/50",
  distribution: "bg-red-900/40 text-red-300 border border-red-700/50",
  liquidation: "bg-gray-800 text-gray-400 border border-gray-700",
  transfer: "bg-gray-800 text-gray-400 border border-gray-700",
};

const MODE_LABELS: Record<TransferRow["mode"], string> = {
  one_time: "One-Time",
  recurring: "Recurring",
  scheduled: "Scheduled",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({
  title,
  count,
  action,
}: {
  title: string;
  count: number;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-gray-700 bg-gray-900 px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold text-gray-100">{title}</h2>
        <p className="text-xs text-gray-500">{count} item{count !== 1 ? "s" : ""}</p>
      </div>
      {action}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="px-4 py-10 text-center text-sm text-gray-500">{message}</div>
  );
}

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function ActionButton({
  onClick,
  label,
  variant,
}: {
  onClick: (e: React.MouseEvent) => void;
  label: string;
  variant: "edit" | "delete";
}) {
  const base = "rounded px-2 py-1 text-xs font-medium transition-colors";
  const styles =
    variant === "edit"
      ? `${base} border border-gray-600 text-gray-400 hover:border-gray-500 hover:text-gray-200`
      : `${base} border border-red-900/50 text-red-400 hover:border-red-700 hover:text-red-300`;
  return (
    <button onClick={onClick} className={styles} aria-label={label}>
      {variant === "edit" ? "Edit" : "Delete"}
    </button>
  );
}

// ── Transfer Card ─────────────────────────────────────────────────────────────

function TransferCard({
  transfer,
  accounts,
  onEdit,
  onDelete,
}: {
  transfer: TransferRow;
  accounts: AccountOption[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const source = accountMap.get(transfer.sourceAccountId);
  const target = accountMap.get(transfer.targetAccountId);
  const classification = classifyTransfer(source, target);

  const sourceName = source?.name ?? "Unknown account";
  const targetName = target?.name ?? "Unknown account";

  const yearRange =
    transfer.endYear != null
      ? `${transfer.startYear} – ${transfer.endYear}`
      : `${transfer.startYear}+`;

  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-800 px-4 py-3 last:border-0">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-100">{transfer.name}</span>
          <Badge
            label={MODE_LABELS[transfer.mode]}
            className="bg-gray-800 text-gray-400 border border-gray-700"
          />
          <Badge
            label={CLASSIFICATION_LABELS[classification]}
            className={CLASSIFICATION_STYLES[classification]}
          />
        </div>
        <div className="text-xs text-gray-400">
          <span className="text-gray-300">{sourceName}</span>
          <span className="mx-1.5 text-gray-600">→</span>
          <span className="text-gray-300">{targetName}</span>
        </div>
        <div className="text-xs text-gray-500">
          {formatCurrency(transfer.amount)} · {yearRange}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ActionButton onClick={(e) => { e.stopPropagation(); onEdit(); }} label={`Edit ${transfer.name}`} variant="edit" />
        <ActionButton onClick={(e) => { e.stopPropagation(); onDelete(); }} label={`Delete ${transfer.name}`} variant="delete" />
      </div>
    </div>
  );
}

// ── Asset Transaction Card ────────────────────────────────────────────────────

function AssetTransactionCard({
  transaction,
  accounts,
  onEdit,
  onDelete,
}: {
  transaction: AssetTransactionRow;
  accounts: AccountOption[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const linkedAccount = transaction.accountId ? accountMap.get(transaction.accountId) : null;
  const fundingAccount = transaction.fundingAccountId
    ? accountMap.get(transaction.fundingAccountId)
    : null;
  const proceedsAccount = transaction.proceedsAccountId
    ? accountMap.get(transaction.proceedsAccountId)
    : null;

  const isBuy = transaction.type === "buy";

  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-800 px-4 py-3 last:border-0">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-100">{transaction.name}</span>
          <Badge
            label={isBuy ? "Buy" : "Sell"}
            className={
              isBuy
                ? "bg-green-900/40 text-green-300 border border-green-700/50"
                : "bg-red-900/40 text-red-300 border border-red-700/50"
            }
          />
          <span className="text-xs text-gray-500">{transaction.year}</span>
        </div>

        {isBuy ? (
          <div className="space-y-0.5 text-xs text-gray-400">
            {transaction.assetName && (
              <div>
                Asset: <span className="text-gray-300">{transaction.assetName}</span>
                {transaction.assetCategory && (
                  <span className="ml-1 text-gray-500">({transaction.assetCategory})</span>
                )}
              </div>
            )}
            {transaction.purchasePrice && (
              <div>
                Purchase price:{" "}
                <span className="text-gray-300">{formatCurrency(transaction.purchasePrice)}</span>
              </div>
            )}
            {fundingAccount && (
              <div>
                Funded by: <span className="text-gray-300">{fundingAccount.name}</span>
              </div>
            )}
            {transaction.mortgageAmount && (
              <div>
                Mortgage:{" "}
                <span className="text-gray-300">{formatCurrency(transaction.mortgageAmount)}</span>
                {transaction.mortgageRate && (
                  <span className="ml-1 text-gray-500">
                    @ {(parseFloat(transaction.mortgageRate) * 100).toFixed(2)}%
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-0.5 text-xs text-gray-400">
            {linkedAccount && (
              <div>
                Account: <span className="text-gray-300">{linkedAccount.name}</span>
              </div>
            )}
            {transaction.overrideSaleValue && (
              <div>
                Sale value:{" "}
                <span className="text-gray-300">
                  {formatCurrency(transaction.overrideSaleValue)}
                </span>
              </div>
            )}
            {proceedsAccount && (
              <div>
                Proceeds to: <span className="text-gray-300">{proceedsAccount.name}</span>
              </div>
            )}
            {transaction.transactionCostPct && (
              <div>
                Transaction cost:{" "}
                <span className="text-gray-300">
                  {(parseFloat(transaction.transactionCostPct) * 100).toFixed(2)}%
                </span>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ActionButton onClick={(e) => { e.stopPropagation(); onEdit(); }} label={`Edit ${transaction.name}`} variant="edit" />
        <ActionButton onClick={(e) => { e.stopPropagation(); onDelete(); }} label={`Delete ${transaction.name}`} variant="delete" />
      </div>
    </div>
  );
}

// ── Main View ─────────────────────────────────────────────────────────────────

export default function TechniquesView({
  clientId,
  transfers,
  assetTransactions,
  accounts,
  liabilities,
}: TechniquesViewProps) {
  const router = useRouter();

  const [showAddTransfer, setShowAddTransfer] = useState(false);
  const [editingTransfer, setEditingTransfer] = useState<TransferRow | null>(null);
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<AssetTransactionRow | null>(null);

  async function handleDeleteTransfer(transferId: string) {
    await fetch(`/api/clients/${clientId}/transfers?transferId=${transferId}`, {
      method: "DELETE",
    });
    router.refresh();
  }

  async function handleDeleteTransaction(transactionId: string) {
    await fetch(
      `/api/clients/${clientId}/asset-transactions?transactionId=${transactionId}`,
      { method: "DELETE" },
    );
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* ── Transfers ─────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-lg border border-gray-700 bg-gray-900/50">
        <SectionHeader
          title="Transfers"
          count={transfers.length}
          action={
            <button
              onClick={() => setShowAddTransfer(true)}
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              + Add Transfer
            </button>
          }
        />
        {transfers.length === 0 ? (
          <EmptyState message="No transfers yet. Click Add Transfer to get started." />
        ) : (
          <div>
            {transfers.map((t) => (
              <TransferCard
                key={t.id}
                transfer={t}
                accounts={accounts}
                onEdit={() => setEditingTransfer(t)}
                onDelete={() => handleDeleteTransfer(t.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Asset Transactions ────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-lg border border-gray-700 bg-gray-900/50">
        <SectionHeader
          title="Asset Transactions"
          count={assetTransactions.length}
          action={
            <button
              onClick={() => setShowAddTransaction(true)}
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              + Add Transaction
            </button>
          }
        />
        {assetTransactions.length === 0 ? (
          <EmptyState message="No asset transactions yet. Click Add Transaction to get started." />
        ) : (
          <div>
            {assetTransactions.map((tx) => (
              <AssetTransactionCard
                key={tx.id}
                transaction={tx}
                accounts={accounts}
                onEdit={() => setEditingTransaction(tx)}
                onDelete={() => handleDeleteTransaction(tx.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Transfer form placeholder (Task 13) ───────────────────────────── */}
      {(showAddTransfer || editingTransfer) && (
        // AddTransferForm will be added in Task 13
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            setShowAddTransfer(false);
            setEditingTransfer(null);
          }}
        >
          <div
            className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-gray-100"
            onClick={(e) => e.stopPropagation()}
          >
            <p>Transfer form placeholder — Task 13</p>
          </div>
        </div>
      )}

      {/* ── Asset Transaction form placeholder (Task 14) ──────────────────── */}
      {(showAddTransaction || editingTransaction) && (
        // AddAssetTransactionForm will be added in Task 14
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            setShowAddTransaction(false);
            setEditingTransaction(null);
          }}
        >
          <div
            className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-gray-100"
            onClick={(e) => e.stopPropagation()}
          >
            <p>Asset transaction form placeholder — Task 14</p>
          </div>
        </div>
      )}
    </div>
  );
}
