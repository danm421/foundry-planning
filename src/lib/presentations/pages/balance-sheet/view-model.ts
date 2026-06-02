import type { BalanceSheetOptions } from "./options-schema";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { OwnershipView } from "@/components/balance-sheet-report/ownership-filter";
import {
  buildViewModel,
  type BalanceSheetViewModel,
  type AccountLike,
  type LiabilityLike,
  type EntityInfo,
} from "@/components/balance-sheet-report/view-model";

const LIQUID_KEYS = new Set(["cash", "taxable", "retirement"]);

/** Liquid portfolio = cash + taxable + retirement category totals. */
export function liquidPortfolioTotal(
  categories: { key: string; total: number }[],
): number {
  return categories
    .filter((c) => LIQUID_KEYS.has(c.key))
    .reduce((sum, c) => sum + c.total, 0);
}

/** Resolve the balance-sheet year: first projection year in `today` mode,
 *  otherwise the selected year clamped to the projection range. */
export function resolveBalanceSheetYear(
  years: { year: number }[],
  options: BalanceSheetOptions,
): number {
  if (years.length === 0) return options.year;
  const first = years[0].year;
  const last = years[years.length - 1].year;
  if (options.asOf === "today") return first;
  return Math.min(Math.max(options.year, first), last);
}

export interface BalanceSheetPageData {
  /** "Today" or "End of <year>". */
  asOfLabel: string;
  /** cash + taxable + retirement category totals. */
  liquidPortfolio: number;
  viewModel: BalanceSheetViewModel;
}

/** Map the presentation context into `buildViewModel` inputs and return the
 *  page data. `view` is "consolidated" for the household balance sheet and
 *  "entities" for the per-entity page. */
export function buildBalanceSheetPageData(
  ctx: BuildDataContext,
  options: BalanceSheetOptions,
  view: OwnershipView,
): BalanceSheetPageData {
  const selectedYear = resolveBalanceSheetYear(ctx.years, options);

  const accounts: AccountLike[] = ctx.clientData.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
    owners: a.owners ?? [],
    parentAccountId: a.parentAccountId ?? null,
    businessType: a.businessType ?? null,
  }));

  const liabilities: LiabilityLike[] = ctx.clientData.liabilities.map((l) => ({
    id: l.id,
    name: l.name,
    owners: l.owners ?? [],
    linkedPropertyId: l.linkedPropertyId ?? null,
    parentAccountId: l.parentAccountId ?? null,
  }));

  const entities: EntityInfo[] = (ctx.clientData.entities ?? []).map((e) => ({
    id: e.id,
    name: e.name ?? "Entity",
    entityType: e.entityType ?? "other",
    isIrrevocable: e.isIrrevocable,
    value: e.value,
    valueGrowthRate: e.valueGrowthRate,
    owners: e.owners,
  }));

  const viewModel = buildViewModel({
    accounts,
    liabilities,
    entities,
    familyMembers: ctx.clientData.familyMembers ?? [],
    projectionYears: ctx.years,
    selectedYear,
    view,
    asOfMode: options.asOf,
  });

  return {
    asOfLabel: options.asOf === "today" ? "Today" : `End of ${selectedYear}`,
    liquidPortfolio: liquidPortfolioTotal(viewModel.assetCategories),
    viewModel,
  };
}
