"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { useScenarioState } from "@/hooks/use-scenario-state";
import { useClientAccess } from "@/components/client-access-provider";
import AddTransferForm from "./forms/add-transfer-form";
import AddReinvestmentForm, { type ReinvestmentInitialData } from "./forms/add-reinvestment-form";
import AddAssetTransactionForm, { type BusinessSaleOption } from "./forms/add-asset-transaction-form";
import AddRothConversionForm, { type RothConversionInitialData } from "./forms/add-roth-conversion-form";
import { HelpTip } from "@/components/help-tip";
import { runProjection } from "@/engine";
import type { ClientData, ProjectionYear } from "@/engine/types";
import type { ClientMilestones, YearRef } from "@/lib/milestones";
import { YEAR_REF_LABELS } from "@/lib/milestones";
import { formatReinvestmentScope } from "@/lib/solver/technique-summaries";

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

export interface ReinvestmentRow {
  id: string;
  name: string;
  accountIds: string[];
  groupKeys: string[];
  year: number;
  yearRef: string | null;
  targetType: "model_portfolio" | "custom";
  realizeTaxesOnSwitch: boolean;
}

export interface AssetTransactionRow {
  id: string;
  name: string;
  type: "buy" | "sell";
  year: number;
  accountId: string | null;
  purchaseTransactionId: string | null;
  /** Set when the sell sources a business account instead of a regular account. */
  businessAccountId: string | null;
  fractionSold: string | null;
  overrideSaleValue: string | null;
  overrideBasis: string | null;
  transactionCostPct: string | null;
  transactionCostFlat: string | null;
  proceedsAccountId: string | null;
  qualifiesForHomeSaleExclusion: boolean | null;
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
  /** Controlling family-member id when 100% owned by a single person.
   *  Used to restrict Roth-conversion sources to the destination's owner. */
  ownerFamilyMemberId?: string | null;
}

export interface LiabilityOption {
  id: string;
  name: string;
  linkedPropertyId: string | null;
  balance: string;
}

export interface EntityOption {
  id: string;
  name: string;
  entityType:
    | "trust"
    | "llc"
    | "s_corp"
    | "c_corp"
    | "partnership"
    | "foundation"
    | "other";
  value: number;
  basis: number;
  owners: Array<{
    familyMemberId: string;
    familyMemberName: string;
    percent: number;
  }>;
  ownedAccounts: Array<{
    id: string;
    name: string;
    entityPercent: number;
    currentValue: number;
  }>;
  ownedLiabilities: Array<{
    id: string;
    name: string;
    entityPercent: number;
    currentBalance: number;
  }>;
}

export interface RothConversionRow {
  id: string;
  name: string;
  destinationAccountId: string;
  sourceAccountIds: string[];
  conversionType: "fixed_amount" | "full_account" | "deplete_over_period" | "fill_up_bracket";
  fixedAmount: string;
  fillUpBracket: string | null;
  startYear: number;
  startYearRef: string | null;
  endYear: number | null;
  endYearRef: string | null;
  indexingRate: string;
  inflationStartYear: number | null;
}

interface TechniquesViewProps {
  clientId: string;
  transfers: TransferRow[];
  reinvestments: ReinvestmentRow[];
  assetTransactions: AssetTransactionRow[];
  rothConversions: RothConversionRow[];
  accounts: AccountOption[];
  liabilities: LiabilityOption[];
  /** Top-level business accounts available as sell sources. */
  businesses: BusinessSaleOption[];
  modelPortfolios: { id: string; name: string }[];
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
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

const ROTH_SUB_TYPES = new Set(["roth_ira"]);
const TAX_DEFERRED_SUB_TYPES = new Set(["traditional_ira", "401k", "403b"]);

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
  liquidation: "bg-card-2 text-ink-2 border border-hair",
  transfer: "bg-card-2 text-ink-2 border border-hair",
};

const MODE_LABELS: Record<TransferRow["mode"], string> = {
  one_time: "One-Time",
  recurring: "Recurring",
  scheduled: "Scheduled",
};

function formatYear(year: number, yearRef: string | null): string {
  if (yearRef && yearRef in YEAR_REF_LABELS) {
    return `${YEAR_REF_LABELS[yearRef as YearRef]} (${year})`;
  }
  return String(year);
}

// ── Shared cells ──────────────────────────────────────────────────────────────

function NumChip({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-hair bg-card-2 text-xs font-semibold tabular-nums text-ink-2"
    >
      {n}
    </span>
  );
}

function Tag({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        className ?? "border-hair bg-card-2 text-ink-2"
      }`}
    >
      {label}
    </span>
  );
}

function TrashIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function RowActions({
  itemName,
  onEdit,
  onDelete,
}: {
  itemName: string;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  if (!onEdit && !onDelete) return null;
  return (
    <div className="flex shrink-0 items-center justify-end gap-1">
      {onEdit && (
        <button
          type="button"
          title="Edit"
          aria-label={`Edit ${itemName}`}
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="rounded border border-hair px-2 py-0.5 text-xs text-ink-2 hover:bg-card-2"
        >
          Edit
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          title="Delete"
          aria-label={`Delete ${itemName}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="rounded p-1 text-white hover:bg-white/10 hover:text-white"
        >
          <TrashIcon />
        </button>
      )}
    </div>
  );
}

function SectionShell({
  title,
  help,
  count,
  addLabel,
  onAdd,
  children,
}: {
  title: string;
  help: string;
  count: number;
  addLabel: string;
  onAdd?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-2">{title}</h2>
          <HelpTip text={help} />
          <span className="text-[10px] tabular-nums text-ink-3">
            {count} {count === 1 ? "item" : "items"}
          </span>
        </div>
        {onAdd && (
          <button
            onClick={onAdd}
            className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-on hover:bg-accent-ink"
          >
            {addLabel}
          </button>
        )}
      </header>
      <div className="overflow-hidden rounded-lg border border-hair bg-card/60">{children}</div>
    </section>
  );
}

function EmptyRow({ message }: { message: string }) {
  return <div className="px-4 py-8 text-center text-sm text-ink-3">{message}</div>;
}

// ── Roth Conversions ──────────────────────────────────────────────────────────

const CONVERSION_TYPE_LABELS: Record<RothConversionRow["conversionType"], string> = {
  fixed_amount: "Fixed",
  full_account: "Full Account",
  deplete_over_period: "Deplete",
  fill_up_bracket: "Fill Bracket",
};

const ROTH_GRID =
  "grid grid-cols-[2.25rem_minmax(0,1.4fr)_minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,1.2fr)_auto] items-center gap-3 px-3 py-2";

function rothDetail(c: RothConversionRow): string {
  switch (c.conversionType) {
    case "fixed_amount": {
      const amt = formatCurrency(c.fixedAmount);
      const rate = parseFloat(c.indexingRate);
      return rate > 0 ? `${amt}/yr · idx ${(rate * 100).toFixed(1)}%` : `${amt}/yr`;
    }
    case "full_account":
      return "Full pool, year 1";
    case "deplete_over_period":
      return "Even split";
    case "fill_up_bracket": {
      const b = c.fillUpBracket ? parseFloat(c.fillUpBracket) : null;
      return b != null ? `Top ${(b * 100).toFixed(0)}% bracket` : "Fill bracket";
    }
  }
}

function RothConversionsTable({
  rows,
  accounts,
  onEdit,
  onDelete,
}: {
  rows: RothConversionRow[];
  accounts: AccountOption[];
  onEdit?: (c: RothConversionRow) => void;
  onDelete?: (id: string) => void;
}) {
  if (rows.length === 0) {
    return <EmptyRow message="No Roth conversions yet." />;
  }
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  return (
    <>
      <div
        className={`${ROTH_GRID} border-b border-hair bg-card-2/40 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3`}
      >
        <span>#</span>
        <span>Name</span>
        <span>Flow</span>
        <span>Years</span>
        <span>Detail</span>
        <span className="text-right">Actions</span>
      </div>
      <ol className="divide-y divide-hair">
        {rows.map((c, idx) => {
          const dest = accountMap.get(c.destinationAccountId);
          const sources = c.sourceAccountIds
            .map((id) => accountMap.get(id))
            .filter((a): a is AccountOption => a != null);
          const sourcesText =
            sources.length === 0
              ? "No sources"
              : sources.length <= 2
                ? sources.map((s) => s.name).join(" + ")
                : `${sources[0].name} + ${sources.length - 1} more`;
          const yearRange =
            c.endYear != null ? `${c.startYear} – ${c.endYear}` : `${c.startYear}+`;
          return (
            <li key={c.id} className={`${ROTH_GRID} hover:bg-card-2/40`}>
              <NumChip n={idx + 1} />
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium text-ink">{c.name}</span>
                <Tag
                  label={CONVERSION_TYPE_LABELS[c.conversionType]}
                  className="border-amber-700/50 bg-amber-900/40 text-amber-300"
                />
              </div>
              <div className="truncate text-xs text-ink-2" title={`${sourcesText} → ${dest?.name ?? "Unknown Roth"}`}>
                <span>{sourcesText}</span>
                <span className="mx-1 text-ink-4">→</span>
                <span>{dest?.name ?? "Unknown Roth"}</span>
              </div>
              <span className="truncate text-xs tabular-nums text-ink-3">{yearRange}</span>
              <span className="truncate text-xs text-ink-3">{rothDetail(c)}</span>
              <RowActions itemName={c.name} onEdit={onEdit ? () => onEdit(c) : undefined} onDelete={onDelete ? () => onDelete(c.id) : undefined} />
            </li>
          );
        })}
      </ol>
    </>
  );
}

// ── Transfers ─────────────────────────────────────────────────────────────────

const TRANSFER_GRID =
  "grid grid-cols-[2.25rem_minmax(0,1.6fr)_minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto] items-center gap-3 px-3 py-2";

function TransfersTable({
  rows,
  accounts,
  onEdit,
  onDelete,
}: {
  rows: TransferRow[];
  accounts: AccountOption[];
  onEdit?: (t: TransferRow) => void;
  onDelete?: (id: string) => void;
}) {
  if (rows.length === 0) {
    return <EmptyRow message="No transfers yet." />;
  }
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  return (
    <>
      <div
        className={`${TRANSFER_GRID} border-b border-hair bg-card-2/40 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3`}
      >
        <span>#</span>
        <span>Name</span>
        <span>Flow</span>
        <span>Amount</span>
        <span>Years</span>
        <span className="text-right">Actions</span>
      </div>
      <ol className="divide-y divide-hair">
        {rows.map((t, idx) => {
          const source = accountMap.get(t.sourceAccountId);
          const target = accountMap.get(t.targetAccountId);
          const classification = classifyTransfer(source, target);
          const yearRange =
            t.endYear != null ? `${t.startYear} – ${t.endYear}` : `${t.startYear}+`;
          return (
            <li key={t.id} className={`${TRANSFER_GRID} hover:bg-card-2/40`}>
              <NumChip n={idx + 1} />
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-medium text-ink">{t.name}</span>
                <Tag label={MODE_LABELS[t.mode]} />
                <Tag
                  label={CLASSIFICATION_LABELS[classification]}
                  className={CLASSIFICATION_STYLES[classification]}
                />
              </div>
              <div
                className="truncate text-xs text-ink-2"
                title={`${source?.name ?? "Unknown"} → ${target?.name ?? "Unknown"}`}
              >
                <span>{source?.name ?? "Unknown account"}</span>
                <span className="mx-1 text-ink-4">→</span>
                <span>{target?.name ?? "Unknown account"}</span>
              </div>
              <span className="truncate text-xs tabular-nums text-ink-2">
                {formatCurrency(t.amount)}
              </span>
              <span className="truncate text-xs tabular-nums text-ink-3">{yearRange}</span>
              <RowActions itemName={t.name} onEdit={onEdit ? () => onEdit(t) : undefined} onDelete={onDelete ? () => onDelete(t.id) : undefined} />
            </li>
          );
        })}
      </ol>
    </>
  );
}

// ── Reinvestments ─────────────────────────────────────────────────────────────

const REINVESTMENT_GRID =
  "grid grid-cols-[2.25rem_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2";

function ReinvestmentsTable({
  rows,
  onEdit,
  onDelete,
}: {
  rows: ReinvestmentRow[];
  onEdit?: (r: ReinvestmentRow) => void;
  onDelete?: (id: string) => void;
}) {
  if (rows.length === 0) {
    return <EmptyRow message="No reinvestments yet." />;
  }
  return (
    <>
      <div
        className={`${REINVESTMENT_GRID} border-b border-hair bg-card-2/40 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3`}
      >
        <span>#</span>
        <span>Name</span>
        <span>Accounts</span>
        <span>Year</span>
        <span className="text-right">Actions</span>
      </div>
      <ol className="divide-y divide-hair">
        {rows.map((r, idx) => {
          const accountCount = r.accountIds.length;
          const groupCount = r.groupKeys.length;
          const targetLabel = r.targetType === "model_portfolio" ? "Model" : "Custom";
          return (
            <li key={r.id} className={`${REINVESTMENT_GRID} hover:bg-card-2/40`}>
              <NumChip n={idx + 1} />
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-medium text-ink">{r.name}</span>
                <Tag label={targetLabel} />
                {r.realizeTaxesOnSwitch && (
                  <Tag
                    label="Taxed"
                    className="border-amber-700/50 bg-amber-900/40 text-amber-300"
                  />
                )}
              </div>
              <span className="truncate text-xs tabular-nums text-ink-2">
                {formatReinvestmentScope(groupCount, accountCount)}
              </span>
              <span className="truncate text-xs tabular-nums text-ink-3">
                {formatYear(r.year, r.yearRef)}
              </span>
              <RowActions itemName={r.name} onEdit={onEdit ? () => onEdit(r) : undefined} onDelete={onDelete ? () => onDelete(r.id) : undefined} />
            </li>
          );
        })}
      </ol>
    </>
  );
}

// ── Asset Transactions ────────────────────────────────────────────────────────

type PastBuy = {
  id: string;
  name: string;
  assetName: string | null;
  year: number;
  assetCategory: string | null;
};

function describeTransaction(
  transaction: AssetTransactionRow,
  accounts: AccountOption[],
  pastBuys: PastBuy[],
  businesses: BusinessSaleOption[],
): string {
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const sellAccount = transaction.accountId ? accountMap.get(transaction.accountId) : null;
  const linkedBuy = transaction.purchaseTransactionId
    ? pastBuys.find((b) => b.id === transaction.purchaseTransactionId)
    : null;
  const sellBusiness = transaction.businessAccountId
    ? businesses.find((b) => b.id === transaction.businessAccountId)
    : null;
  const isSell = transaction.type === "sell";
  const isOrphanSell =
    isSell &&
    !transaction.accountId &&
    !transaction.purchaseTransactionId &&
    !transaction.businessAccountId;
  const hasSellSource = !!sellAccount || !!linkedBuy || !!sellBusiness;
  const hasBuy = !!(transaction.assetName || (transaction.purchasePrice && parseFloat(transaction.purchasePrice) > 0));

  let sellLabel: string | null = null;
  if (isOrphanSell) {
    sellLabel = "Sell — source removed";
  } else if (sellBusiness) {
    sellLabel = `Sell ${sellBusiness.name} (business)`;
  } else if (sellAccount) {
    sellLabel = `Sell ${sellAccount.name}`;
  } else if (linkedBuy) {
    sellLabel = `Sell ${linkedBuy.assetName ?? linkedBuy.name} (buy ${linkedBuy.year})`;
  }

  if (sellLabel && hasBuy) {
    return `${sellLabel} → Buy ${transaction.assetName ?? "New Asset"}`;
  }
  if (sellLabel) return sellLabel;
  if (hasBuy) return `Buy ${transaction.assetName ?? "New Asset"}`;
  if (isSell && !hasSellSource) return "Sell";
  return transaction.type === "buy" ? "Buy" : "Sell";
}

interface SaleBreakdown {
  saleValue: number;
  transactionCosts: number;
  mortgagePayoff: number;
  netProceeds: number;
  saleValueIsProjected: boolean;
  mortgagePayoffIsProjected: boolean;
}

function computeSaleBreakdown(
  transaction: AssetTransactionRow,
  liabilities: LiabilityOption[],
  projectedSaleValue: number | null,
  projectedMortgagePayoff: number | null,
): SaleBreakdown | null {
  if (!transaction.accountId) return null;

  const overrideSaleValue = transaction.overrideSaleValue
    ? parseFloat(transaction.overrideSaleValue)
    : null;
  const saleValue = overrideSaleValue ?? projectedSaleValue ?? 0;
  const saleValueIsProjected = overrideSaleValue == null && projectedSaleValue != null;

  const costPct = transaction.transactionCostPct ? parseFloat(transaction.transactionCostPct) : 0;
  const costFlat = transaction.transactionCostFlat ? parseFloat(transaction.transactionCostFlat) : 0;
  const transactionCosts = saleValue * costPct + costFlat;

  const linkedMortgage = liabilities.find(
    (l) => l.linkedPropertyId === transaction.accountId,
  );
  const staticBalance = linkedMortgage ? parseFloat(linkedMortgage.balance) : 0;
  const mortgagePayoff = linkedMortgage
    ? projectedMortgagePayoff ?? staticBalance
    : 0;
  const mortgagePayoffIsProjected =
    !!linkedMortgage && projectedMortgagePayoff != null;

  const netProceeds = saleValue - transactionCosts - mortgagePayoff;

  return {
    saleValue,
    transactionCosts,
    mortgagePayoff,
    netProceeds,
    saleValueIsProjected,
    mortgagePayoffIsProjected,
  };
}

function computeTransactionNet(
  transaction: AssetTransactionRow,
  liabilities: LiabilityOption[],
  projectedSaleValue: number | null,
  projectedMortgagePayoff: number | null,
): number | null {
  const hasSell = !!transaction.accountId;
  const hasBuy = !!(transaction.assetName || (transaction.purchasePrice && parseFloat(transaction.purchasePrice) > 0));
  if (!hasSell || !hasBuy) return null;

  const sale = computeSaleBreakdown(
    transaction,
    liabilities,
    projectedSaleValue,
    projectedMortgagePayoff,
  );
  const saleProceeds = sale ? sale.netProceeds : 0;

  const price = transaction.purchasePrice ? parseFloat(transaction.purchasePrice) : 0;
  const buyMortgage = transaction.mortgageAmount ? parseFloat(transaction.mortgageAmount) : 0;
  const purchaseCost = price - buyMortgage;

  return saleProceeds - purchaseCost;
}

const TXN_GRID =
  "grid grid-cols-[2.25rem_minmax(0,1.3fr)_minmax(0,0.5fr)_minmax(0,1.8fr)_minmax(0,0.9fr)_auto] items-center gap-3 px-3 py-2";

function txnHeadlineFigure(
  txn: AssetTransactionRow,
  liabilities: LiabilityOption[],
  businesses: BusinessSaleOption[],
  projectedSaleValue: number | null,
  projectedMortgagePayoff: number | null,
): { value: string; tone: "ink" | "good" | "crit"; title: string } | null {
  const hasSell = !!txn.accountId;
  const hasBuy = !!(txn.assetName || (txn.purchasePrice && parseFloat(txn.purchasePrice) > 0));
  const isBusinessSell = !!txn.businessAccountId;
  const net = computeTransactionNet(txn, liabilities, projectedSaleValue, projectedMortgagePayoff);

  // Business sales: show overrideSaleValue (or the business's catalog value)
  // as the headline sale amount. Cascaded liquidations are not yet
  // pre-projected here, so this is an operating-value-only estimate.
  if (isBusinessSell) {
    const business = businesses.find((b) => b.id === txn.businessAccountId);
    const override = txn.overrideSaleValue
      ? parseFloat(txn.overrideSaleValue)
      : null;
    const baseValue = override ?? business?.value ?? 0;
    const fraction = txn.fractionSold ? parseFloat(txn.fractionSold) : 1;
    const operatingSale = baseValue * fraction;
    return {
      value: formatCurrency(operatingSale),
      tone: "ink",
      title: `Business sale: ${formatCurrency(operatingSale)} (operating value, before cascade)`,
    };
  }

  if (net != null) {
    return {
      value: `${net >= 0 ? "+" : ""}${formatCurrency(net)}`,
      tone: net >= 0 ? "good" : "crit",
      title: "Net surplus after sale proceeds minus purchase cost",
    };
  }

  if (hasSell) {
    const sale = computeSaleBreakdown(txn, liabilities, projectedSaleValue, projectedMortgagePayoff);
    if (sale) {
      const parts = [`Sale: ${formatCurrency(sale.saleValue)}`];
      if (sale.transactionCosts > 0) parts.push(`Costs: −${formatCurrency(sale.transactionCosts)}`);
      if (sale.mortgagePayoff > 0) parts.push(`Payoff: −${formatCurrency(sale.mortgagePayoff)}`);
      parts.push(`Net: ${formatCurrency(sale.netProceeds)}`);
      return {
        value: formatCurrency(sale.netProceeds),
        tone: sale.netProceeds >= 0 ? "ink" : "crit",
        title: parts.join("  ·  "),
      };
    }
  }

  if (hasBuy && txn.purchasePrice) {
    const mortgage = txn.mortgageAmount ? parseFloat(txn.mortgageAmount) : 0;
    const out = parseFloat(txn.purchasePrice) - mortgage;
    return {
      value: formatCurrency(out),
      tone: "ink",
      title: mortgage > 0 ? `Purchase ${formatCurrency(txn.purchasePrice)} − mortgage ${formatCurrency(mortgage)}` : "Cash out of pocket",
    };
  }

  return null;
}

function AssetTransactionsTable({
  rows,
  accounts,
  liabilities,
  businesses,
  pastBuys,
  projectedSaleValueFor,
  projectedMortgagePayoffFor,
  onEdit,
  onDelete,
}: {
  rows: AssetTransactionRow[];
  accounts: AccountOption[];
  liabilities: LiabilityOption[];
  businesses: BusinessSaleOption[];
  pastBuys: PastBuy[];
  projectedSaleValueFor: (accountId: string, year: number) => number | null;
  projectedMortgagePayoffFor: (liabilityId: string, year: number) => number | null;
  onEdit?: (t: AssetTransactionRow) => void;
  onDelete?: (id: string) => void;
}) {
  if (rows.length === 0) {
    return <EmptyRow message="No asset transactions yet." />;
  }
  return (
    <>
      <div
        className={`${TXN_GRID} border-b border-hair bg-card-2/40 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3`}
      >
        <span>#</span>
        <span>Name</span>
        <span>Year</span>
        <span>Flow</span>
        <span className="text-right">Net</span>
        <span className="text-right">Actions</span>
      </div>
      <ol className="divide-y divide-hair">
        {rows.map((tx, idx) => {
          const linkedMortgage = tx.accountId
            ? liabilities.find((l) => l.linkedPropertyId === tx.accountId)
            : null;
          const projectedMortgagePayoff = linkedMortgage
            ? projectedMortgagePayoffFor(linkedMortgage.id, tx.year)
            : null;
          const projectedSaleValue = tx.accountId
            ? projectedSaleValueFor(tx.accountId, tx.year)
            : null;

          const isBusinessSell = !!tx.businessAccountId;
          const hasSell = !!tx.accountId || isBusinessSell;
          const hasBuy = !!(tx.assetName || (tx.purchasePrice && parseFloat(tx.purchasePrice) > 0));
          const isOrphanSell =
            tx.type === "sell" &&
            !tx.accountId &&
            !tx.purchaseTransactionId &&
            !tx.businessAccountId;

          let badgeLabel: string;
          let badgeClass: string;
          if (hasSell && hasBuy) {
            badgeLabel = "Sell+Buy";
            badgeClass = "border-accent/40 bg-accent/15 text-accent-ink";
          } else if (hasBuy) {
            badgeLabel = "Buy";
            badgeClass = "border-green-700/50 bg-green-900/40 text-green-300";
          } else {
            badgeLabel = "Sell";
            badgeClass = "border-red-700/50 bg-red-900/40 text-red-300";
          }

          const description = describeTransaction(tx, accounts, pastBuys, businesses);
          const headline = txnHeadlineFigure(tx, liabilities, businesses, projectedSaleValue, projectedMortgagePayoff);
          const headlineTone =
            headline?.tone === "good"
              ? "text-good"
              : headline?.tone === "crit"
                ? "text-crit"
                : "text-ink-2";

          return (
            <li key={tx.id} className={`${TXN_GRID} hover:bg-card-2/40`}>
              <NumChip n={idx + 1} />
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-medium text-ink">{tx.name}</span>
                <Tag label={badgeLabel} className={badgeClass} />
                {isBusinessSell && (
                  <Tag
                    label="Business"
                    className="border-amber-700/50 bg-amber-900/30 text-amber-200"
                  />
                )}
                {isOrphanSell && (
                  <Tag
                    label="Source removed"
                    className="border-red-700/60 bg-red-950/50 text-red-300"
                  />
                )}
              </div>
              <span className="truncate text-xs tabular-nums text-ink-3">{tx.year}</span>
              <span className="truncate text-xs text-ink-2" title={description}>
                {description}
              </span>
              <span
                className={`truncate text-right text-xs tabular-nums ${headlineTone}`}
                title={headline?.title ?? ""}
              >
                {headline?.value ?? "—"}
              </span>
              <RowActions itemName={tx.name} onEdit={onEdit ? () => onEdit(tx) : undefined} onDelete={onDelete ? () => onDelete(tx.id) : undefined} />
            </li>
          );
        })}
      </ol>
    </>
  );
}

// ── Main View ─────────────────────────────────────────────────────────────────

export default function TechniquesView({
  clientId,
  transfers,
  reinvestments,
  assetTransactions,
  rothConversions,
  accounts,
  liabilities,
  businesses,
  modelPortfolios,
  milestones,
  clientFirstName,
  spouseFirstName,
}: TechniquesViewProps) {
  const router = useRouter();
  const writer = useScenarioWriter(clientId);
  const { scenarioId } = useScenarioState(clientId);
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";

  const [showAddTransfer, setShowAddTransfer] = useState(false);
  const [editingTransfer, setEditingTransfer] = useState<TransferRow | null>(null);
  const [showAddReinvestment, setShowAddReinvestment] = useState(false);
  const [editingReinvestment, setEditingReinvestment] = useState<ReinvestmentInitialData | null>(null);
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<AssetTransactionRow | null>(null);
  const [showAddRothConversion, setShowAddRothConversion] = useState(false);
  const [editingRothConversion, setEditingRothConversion] = useState<RothConversionInitialData | null>(null);
  const [projectionYears, setProjectionYears] = useState<ProjectionYear[] | null>(null);

  // Load projection so transaction rows can display the projected BoY sale
  // value and mortgage payoff for the sale year (matches what the engine will
  // use). Pass the active scenario so scenario-only accounts (e.g. an
  // entity-owned asset added inside this scenario) resolve a real value —
  // without it the endpoint loads base-plan data and a scenario-only sell
  // account prices at $0, yielding a bogus negative NET preview.
  useEffect(() => {
    let cancelled = false;
    async function loadProjection() {
      try {
        const url = scenarioId
          ? `/api/clients/${clientId}/projection-data?scenario=${encodeURIComponent(scenarioId)}`
          : `/api/clients/${clientId}/projection-data`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data: ClientData = await res.json();
        const projection = runProjection(data);
        if (!cancelled) setProjectionYears(projection);
      } catch {
        // Net preview falls back to the static DB balance silently.
      }
    }
    loadProjection();
    return () => { cancelled = true; };
  }, [clientId, scenarioId]);

  const projectedMortgagePayoffFor = useMemo(() => {
    return (liabilityId: string, year: number): number | null => {
      if (!projectionYears) return null;
      const py = projectionYears.find((p) => p.year === year);
      const bal = py?.liabilityBalancesBoY?.[liabilityId];
      return bal != null ? bal : null;
    };
  }, [projectionYears]);

  const projectedSaleValueFor = useMemo(() => {
    return (accountId: string, year: number): number | null => {
      if (!projectionYears) return null;
      const py = projectionYears.find((p) => p.year === year);
      const ledger = py?.accountLedgers?.[accountId];
      return ledger ? ledger.beginningValue : null;
    };
  }, [projectionYears]);

  const pastBuys = useMemo(
    () =>
      assetTransactions
        .filter((t) => t.type === "buy")
        .map((t) => ({
          id: t.id,
          name: t.name,
          assetName: t.assetName,
          year: t.year,
          assetCategory: t.assetCategory,
        })),
    [assetTransactions],
  );

  async function handleDeleteTransfer(transferId: string) {
    if (!canEdit) return;
    await writer.submit(
      { op: "remove", targetKind: "transfer", targetId: transferId },
      {
        url: `/api/clients/${clientId}/transfers?transferId=${transferId}`,
        method: "DELETE",
      },
    );
    router.refresh();
  }

  async function handleDeleteReinvestment(reinvestmentId: string) {
    if (!canEdit) return;
    await writer.submit(
      { op: "remove", targetKind: "reinvestment", targetId: reinvestmentId },
      {
        url: `/api/clients/${clientId}/reinvestments?reinvestmentId=${reinvestmentId}`,
        method: "DELETE",
      },
    );
    router.refresh();
  }

  async function handleDeleteTransaction(transactionId: string) {
    if (!canEdit) return;
    await writer.submit(
      { op: "remove", targetKind: "asset_transaction", targetId: transactionId },
      {
        url: `/api/clients/${clientId}/asset-transactions?transactionId=${transactionId}`,
        method: "DELETE",
      },
    );
    router.refresh();
  }

  async function handleDeleteRothConversion(rothConversionId: string) {
    if (!canEdit) return;
    await writer.submit(
      { op: "remove", targetKind: "roth_conversion", targetId: rothConversionId },
      {
        url: `/api/clients/${clientId}/roth-conversions?rothConversionId=${rothConversionId}`,
        method: "DELETE",
      },
    );
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <SectionShell
        title="Roth Conversions"
        help="Move dollars from tax-deferred accounts (Traditional IRA, 401(k)) into a Roth IRA, paying ordinary income tax now in exchange for tax-free growth and withdrawals."
        count={rothConversions.length}
        addLabel="+ Add Roth Conversion"
        onAdd={canEdit ? () => setShowAddRothConversion(true) : undefined}
      >
        <RothConversionsTable
          rows={rothConversions}
          accounts={accounts}
          onEdit={canEdit ? (c) => setEditingRothConversion(c) : undefined}
          onDelete={canEdit ? (id) => handleDeleteRothConversion(id) : undefined}
        />
      </SectionShell>

      <SectionShell
        title="Transfers"
        help="Move money between accounts on a one-time, recurring, or scheduled basis. Classification (Roth conversion, rollover, distribution, liquidation) is inferred from the source and target account types."
        count={transfers.length}
        addLabel="+ Add Transfer"
        onAdd={canEdit ? () => setShowAddTransfer(true) : undefined}
      >
        <TransfersTable
          rows={transfers}
          accounts={accounts}
          onEdit={canEdit ? (t) => setEditingTransfer(t) : undefined}
          onDelete={canEdit ? (id) => handleDeleteTransfer(id) : undefined}
        />
      </SectionShell>

      <SectionShell
        title="Reinvestments"
        help="Re-allocate an account at a chosen year — switch to a model portfolio or a custom growth rate. Optionally realize embedded gains as taxes in the switch year."
        count={reinvestments.length}
        addLabel="+ Add Reinvestment"
        onAdd={canEdit ? () => setShowAddReinvestment(true) : undefined}
      >
        <ReinvestmentsTable
          rows={reinvestments}
          onEdit={canEdit ? (r) => setEditingReinvestment(r) : undefined}
          onDelete={canEdit ? (id) => handleDeleteReinvestment(id) : undefined}
        />
      </SectionShell>

      <SectionShell
        title="Asset Transactions"
        help="Buy or sell a specific asset (real estate, business interest, vehicle). Sells use the projected end-of-year value unless overridden; Sell+Buy lets you roll proceeds into a replacement purchase."
        count={assetTransactions.length}
        addLabel="+ Add Transaction"
        onAdd={canEdit ? () => setShowAddTransaction(true) : undefined}
      >
        <AssetTransactionsTable
          rows={assetTransactions}
          accounts={accounts}
          liabilities={liabilities}
          businesses={businesses}
          pastBuys={pastBuys}
          projectedSaleValueFor={projectedSaleValueFor}
          projectedMortgagePayoffFor={projectedMortgagePayoffFor}
          onEdit={canEdit ? (t) => setEditingTransaction(t) : undefined}
          onDelete={canEdit ? (id) => handleDeleteTransaction(id) : undefined}
        />
      </SectionShell>

      {canEdit && (showAddTransfer || editingTransfer) && (
        <AddTransferForm
          clientId={clientId}
          accounts={accounts}
          milestones={milestones}
          clientFirstName={clientFirstName}
          spouseFirstName={spouseFirstName}
          initialData={editingTransfer ?? undefined}
          onClose={() => { setShowAddTransfer(false); setEditingTransfer(null); }}
          onSaved={() => { setShowAddTransfer(false); setEditingTransfer(null); router.refresh(); }}
        />
      )}

      {canEdit && (showAddReinvestment || editingReinvestment) && (
        <AddReinvestmentForm
          clientId={clientId}
          accounts={accounts}
          modelPortfolios={modelPortfolios}
          milestones={milestones}
          clientFirstName={clientFirstName}
          spouseFirstName={spouseFirstName}
          initialData={editingReinvestment ?? undefined}
          onClose={() => { setShowAddReinvestment(false); setEditingReinvestment(null); }}
          onSaved={() => { setShowAddReinvestment(false); setEditingReinvestment(null); router.refresh(); }}
        />
      )}

      {canEdit && (showAddRothConversion || editingRothConversion) && (
        <AddRothConversionForm
          clientId={clientId}
          accounts={accounts}
          milestones={milestones}
          clientFirstName={clientFirstName}
          spouseFirstName={spouseFirstName}
          initialData={editingRothConversion ?? undefined}
          onClose={() => { setShowAddRothConversion(false); setEditingRothConversion(null); }}
          onSaved={() => { setShowAddRothConversion(false); setEditingRothConversion(null); router.refresh(); }}
        />
      )}

      {canEdit && (showAddTransaction || editingTransaction) && (
        <AddAssetTransactionForm
          clientId={clientId}
          accounts={accounts}
          liabilities={liabilities}
          businesses={businesses}
          pastBuys={pastBuys}
          milestones={milestones}
          clientFirstName={clientFirstName}
          spouseFirstName={spouseFirstName}
          initialData={editingTransaction ?? undefined}
          onClose={() => { setShowAddTransaction(false); setEditingTransaction(null); }}
          onSaved={() => { setShowAddTransaction(false); setEditingTransaction(null); router.refresh(); }}
        />
      )}
    </div>
  );
}
