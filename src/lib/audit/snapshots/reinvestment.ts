// src/lib/audit/snapshots/reinvestment.ts
import "server-only";
import { db } from "@/db";
import {
  accounts,
  modelPortfolios,
  reinvestmentAccounts,
  reinvestmentGroups,
  reinvestments,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import type { EntitySnapshot, FieldLabels, ReferenceValue } from "../types";

export const REINVESTMENT_FIELD_LABELS: FieldLabels = {
  name: { label: "Name", format: "text" },
  year: { label: "Year", format: "text" },
  yearRef: { label: "Year reference", format: "text" },
  targetType: { label: "Target", format: "text" },
  modelPortfolioId: { label: "Model portfolio", format: "reference" },
  customGrowthRate: { label: "Custom growth rate", format: "percent" },
  realizeTaxesOnSwitch: {
    label: "Apply taxes on switch",
    format: "text",
  },
  accountIds: { label: "Accounts", format: "reference" },
  groupKeys: { label: "Investment groups", format: "text" },
};

type ReinvestmentRow = typeof reinvestments.$inferSelect;

export async function toReinvestmentSnapshot(
  row: ReinvestmentRow,
): Promise<EntitySnapshot> {
  // Account ids live in the reinvestment_accounts join table, not on the row.
  const linkRows = await db
    .select({ accountId: reinvestmentAccounts.accountId })
    .from(reinvestmentAccounts)
    .where(eq(reinvestmentAccounts.reinvestmentId, row.id));
  const accountIds = linkRows.map((r) => r.accountId);

  const groupRows = await db
    .select({ groupKey: reinvestmentGroups.groupKey })
    .from(reinvestmentGroups)
    .where(eq(reinvestmentGroups.reinvestmentId, row.id));
  const groupKeys = groupRows.map((g) => g.groupKey);

  const accountRows = accountIds.length
    ? await db
        .select({ id: accounts.id, name: accounts.name })
        .from(accounts)
        .where(inArray(accounts.id, accountIds))
    : [];
  const accountMap = new Map(accountRows.map((r) => [r.id, r.name]));

  let modelPortfolioRef: ReferenceValue | null = null;
  if (row.modelPortfolioId) {
    const [mp] = await db
      .select({ id: modelPortfolios.id, name: modelPortfolios.name })
      .from(modelPortfolios)
      .where(eq(modelPortfolios.id, row.modelPortfolioId));
    modelPortfolioRef = {
      id: row.modelPortfolioId,
      display: mp?.name ?? "(deleted)",
    };
  }

  return {
    name: row.name,
    year: row.year,
    yearRef: row.yearRef,
    targetType: row.targetType,
    modelPortfolioId: modelPortfolioRef,
    customGrowthRate:
      row.customGrowthRate != null ? Number(row.customGrowthRate) : null,
    realizeTaxesOnSwitch: row.realizeTaxesOnSwitch,
    accountIds: accountIds.map(
      (id): ReferenceValue => ({
        id,
        display: accountMap.get(id) ?? "(deleted)",
      }),
    ),
    groupKeys: groupKeys.join(", "),
  };
}
