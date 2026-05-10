// src/lib/reports/tax-cell-drill/income-breakdown.ts
import type {
  CellDrillProps,
  CellDrillRow,
  IncomeCellDrillArgs,
  IncomeColumnKey,
} from "./types";
import { resolveSourceLabel } from "./_shared";

const COLUMN_LABEL: Record<IncomeColumnKey, string> = {
  earnedIncome: "Earned Income",
  taxableSocialSecurity: "Taxable Social Security",
  ordinaryIncome: "Ordinary Income",
  dividends: "Dividends",
  capitalGains: "LT Capital Gains",
  shortCapitalGains: "ST Capital Gains",
  totalIncome: "Total Income",
  nonTaxableIncome: "Non-Taxable Income",
  grossTotalIncome: "Gross Total Income",
};

type DirectConfig = {
  sourceType: string;
  taxDetailKey: keyof NonNullable<IncomeCellDrillArgs["year"]["taxDetail"]>;
};

const DIRECT_CONFIG: Partial<Record<IncomeColumnKey, DirectConfig>> = {
  earnedIncome:      { sourceType: "earned_income",   taxDetailKey: "earnedIncome" },
  ordinaryIncome:    { sourceType: "ordinary_income",  taxDetailKey: "ordinaryIncome" },
  dividends:         { sourceType: "dividends",        taxDetailKey: "dividends" },
  capitalGains:      { sourceType: "capital_gains",    taxDetailKey: "capitalGains" },
  shortCapitalGains: { sourceType: "stcg",             taxDetailKey: "stCapitalGains" },
};

export function buildIncomeCellDrill(args: IncomeCellDrillArgs): CellDrillProps {
  const { year, columnKey, ctx } = args;
  const title = `${COLUMN_LABEL[columnKey]} — ${year.year}`;

  const directCfg = DIRECT_CONFIG[columnKey];
  if (directCfg) {
    const total = (year.taxDetail?.[directCfg.taxDetailKey] as number | undefined) ?? 0;
    const rows = directRows(year, directCfg.sourceType, ctx);
    return { title, total, groups: [{ rows }] };
  }

  // taxableSocialSecurity / nonTaxableIncome / totalIncome / grossTotalIncome
  // — implemented in subsequent tasks. Stub: empty group with header.
  const total = year.taxResult?.income[columnKey] ?? 0;
  return { title, total, groups: [{ rows: [] }] };
}

function directRows(
  year: IncomeCellDrillArgs["year"],
  type: string,
  ctx: IncomeCellDrillArgs["ctx"],
): CellDrillRow[] {
  const bySource = year.taxDetail?.bySource ?? {};
  return Object.entries(bySource)
    .filter(([, v]) => v.type === type)
    .map(([id, v]) => ({ id, label: resolveSourceLabel(id, ctx), amount: v.amount }))
    .sort((a, b) => b.amount - a.amount);
}
