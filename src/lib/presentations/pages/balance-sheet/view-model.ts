import type { BalanceSheetOptions } from "./options-schema";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { OwnershipView } from "@/components/balance-sheet-report/ownership-filter";
import {
  buildViewModel,
  type BalanceSheetViewModel,
} from "@/components/balance-sheet-report/view-model";
import { buildViewModelInputs } from "@/lib/balance-sheet/build-view-model-inputs";
import { mergeSyntheticAccounts } from "@/lib/balance-sheet/merge-synthetic-accounts";
import { LIQUID_CATEGORIES, type AccountCategory } from "@/lib/account-groups/liquid-filter";

/** Liquid portfolio = cash + taxable + retirement category totals. */
export function liquidPortfolioTotal(
  categories: { key: string; total: number }[],
): number {
  return categories
    .filter((c) => LIQUID_CATEGORIES.has(c.key as AccountCategory))
    .reduce((sum, c) => sum + c.total, 0);
}

/** Resolve the balance-sheet year: first projection year in `today` mode,
 *  otherwise the selected year clamped to the projection range. */
export function resolveBalanceSheetYear(
  years: { year: number }[],
  options: Pick<BalanceSheetOptions, "asOf" | "year">,
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
  /** Render the Out of Estate table (opt-in; consolidated view only). */
  showOutOfEstate: boolean;
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

  // `buildViewModelInputs` is the canonical `ClientData` → view-model-inputs
  // mapper, shared with the on-screen balance-sheet report so both stay in
  // sync. (Its `notesReceivable` output is unused by `buildViewModel`.)
  const { accounts, liabilities, entities, familyMembers } =
    buildViewModelInputs(mergeSyntheticAccounts(ctx.clientData, ctx.years));

  const viewModel = buildViewModel({
    accounts,
    liabilities,
    entities,
    familyMembers,
    projectionYears: ctx.years,
    selectedYear,
    view,
    asOfMode: options.asOf,
  });

  return {
    asOfLabel: options.asOf === "today" ? "Today" : `End of ${selectedYear}`,
    liquidPortfolio: liquidPortfolioTotal(viewModel.assetCategories),
    showOutOfEstate: options.includeOutOfEstate,
    viewModel,
  };
}
