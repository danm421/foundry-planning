// src/lib/audit/snapshots/asset-transaction.ts
import "server-only";
import { db } from "@/db";
import { accounts, assetTransactions, modelPortfolios } from "@/db/schema";
import { inArray } from "drizzle-orm";
import type { EntitySnapshot, ReferenceValue } from "../types";

// Labels live in the server-free `../field-labels` (audit F3); re-exported
// here so server callers keep one import site.
export { ASSET_TRANSACTION_FIELD_LABELS } from "../field-labels";

type AssetTransactionRow = typeof assetTransactions.$inferSelect;

export async function toAssetTransactionSnapshot(
  row: AssetTransactionRow,
): Promise<EntitySnapshot> {
  const accountIds = [
    row.accountId,
    row.proceedsAccountId,
    row.fundingAccountId,
  ].filter((x): x is string => Boolean(x));

  const accountRows = accountIds.length
    ? await db
        .select({ id: accounts.id, name: accounts.name })
        .from(accounts)
        .where(inArray(accounts.id, accountIds))
    : [];

  const accountMap = new Map(accountRows.map((r) => [r.id, r.name]));

  const refOrNull = (id: string | null): ReferenceValue | null =>
    id === null ? null : { id, display: accountMap.get(id) ?? "(deleted)" };

  const modelPortfolio = row.modelPortfolioId
    ? await db
        .select({ id: modelPortfolios.id, name: modelPortfolios.name })
        .from(modelPortfolios)
        .where(inArray(modelPortfolios.id, [row.modelPortfolioId]))
        .then((rows) => ({
          id: row.modelPortfolioId!,
          display: rows[0]?.name ?? "(deleted)",
        }))
    : null;

  const businessAccount = row.businessAccountId
    ? await db
        .select({ id: accounts.id, name: accounts.name })
        .from(accounts)
        .where(inArray(accounts.id, [row.businessAccountId]))
        .then((rows) => ({
          id: row.businessAccountId!,
          display: rows[0]?.name ?? "(deleted)",
        }))
    : null;

  return {
    name: row.name,
    type: row.type,
    year: row.year,
    account: refOrNull(row.accountId),
    overrideSaleValue:
      row.overrideSaleValue === null ? null : Number(row.overrideSaleValue),
    overrideBasis: row.overrideBasis === null ? null : Number(row.overrideBasis),
    transactionCostPct:
      row.transactionCostPct === null ? null : Number(row.transactionCostPct),
    transactionCostFlat:
      row.transactionCostFlat === null ? null : Number(row.transactionCostFlat),
    proceedsAccount: refOrNull(row.proceedsAccountId),
    qualifiesForHomeSaleExclusion: row.qualifiesForHomeSaleExclusion,
    assetName: row.assetName,
    assetCategory: row.assetCategory,
    assetSubType: row.assetSubType,
    purchasePrice:
      row.purchasePrice === null ? null : Number(row.purchasePrice),
    growthRate: row.growthRate === null ? null : Number(row.growthRate),
    growthSource: row.growthSource,
    modelPortfolio,
    basis: row.basis === null ? null : Number(row.basis),
    fundingAccount: refOrNull(row.fundingAccountId),
    mortgageAmount:
      row.mortgageAmount === null ? null : Number(row.mortgageAmount),
    mortgageRate: row.mortgageRate === null ? null : Number(row.mortgageRate),
    mortgageTermMonths: row.mortgageTermMonths,
    businessAccount,
  };
}
