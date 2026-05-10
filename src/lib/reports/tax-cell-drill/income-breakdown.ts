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

  if (columnKey === "taxableSocialSecurity") {
    const total = year.taxResult?.income.taxableSocialSecurity ?? 0;
    return { title, total, groups: [{ rows: socialSecurityRows(year, ctx, "taxable") }] };
  }

  // nonTaxableIncome / totalIncome / grossTotalIncome — later tasks.
  const total = year.taxResult?.income[columnKey] ?? 0;
  return { title, total, groups: [{ rows: [] }] };
}

function socialSecurityRows(
  year: IncomeCellDrillArgs["year"],
  ctx: IncomeCellDrillArgs["ctx"],
  portion: "taxable" | "non_taxable",
): CellDrillRow[] {
  const grossHousehold = year.income.socialSecurity ?? 0;
  if (grossHousehold <= 0) return [];
  const taxable = year.taxResult?.income.taxableSocialSecurity ?? 0;
  const fraction =
    portion === "taxable"
      ? Math.min(1, taxable / grossHousehold)
      : Math.max(0, 1 - taxable / grossHousehold);

  const ssIncomes = ctx.incomes.filter((i) => i.type === "social_security");
  const incomeBySource = year.income.bySource ?? {};
  return ssIncomes
    .map((inc) => {
      const gross = incomeBySource[inc.id] ?? 0;
      return {
        id: inc.id,
        label: inc.name,
        amount: Math.round(gross * fraction),
        meta:
          portion === "taxable"
            ? `${Math.round(fraction * 100)}% of $${Math.round(gross).toLocaleString()} gross taxable`
            : `${Math.round(fraction * 100)}% of $${Math.round(gross).toLocaleString()} gross excluded`,
      };
    })
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
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
