import type {
  CellDrillProps,
  CellDrillRow,
  IncomeCellDrillArgs,
  IncomeColumnKey,
} from "./types";
import { bySourceRows, resolveSourceLabel } from "./_shared";

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

  if (columnKey === "nonTaxableIncome") {
    const total = year.taxResult?.income.nonTaxableIncome ?? 0;
    const groups = nonTaxableGroups(year, ctx);
    return { title, total, groups };
  }

  if (columnKey === "totalIncome") {
    const total = year.taxResult?.income.totalIncome ?? 0;
    return { title, total, groups: totalIncomeGroups(year, ctx) };
  }

  if (columnKey === "grossTotalIncome") {
    const total = year.taxResult?.income.grossTotalIncome ?? 0;
    return { title, total, groups: [...totalIncomeGroups(year, ctx), ...nonTaxableGroups(year, ctx)] };
  }

  return { title, total: year.taxResult?.income[columnKey] ?? 0, groups: [] };
}

function totalIncomeGroups(
  year: IncomeCellDrillArgs["year"],
  ctx: IncomeCellDrillArgs["ctx"],
): CellDrillProps["groups"] {
  const groups: CellDrillProps["groups"] = [];
  const push = (label: string, rows: CellDrillRow[]) => {
    if (rows.length > 0) groups.push({ label, rows });
  };
  push("Earned Income", directRows(year, "earned_income", ctx));
  push("Taxable Social Security", socialSecurityRows(year, ctx, "taxable"));
  push("Ordinary Income", directRows(year, "ordinary_income", ctx));
  push("Dividends", directRows(year, "dividends", ctx));
  push("LT Capital Gains", directRows(year, "capital_gains", ctx));
  push("ST Capital Gains", directRows(year, "stcg", ctx));
  return groups;
}

function nonTaxableGroups(
  year: IncomeCellDrillArgs["year"],
  ctx: IncomeCellDrillArgs["ctx"],
): CellDrillProps["groups"] {
  const groups: CellDrillProps["groups"] = [];

  const exemptRows = directRows(year, "tax_exempt", ctx);
  if (exemptRows.length > 0) {
    groups.push({ label: "Tax-Exempt Income", rows: exemptRows });
  }

  const ssRows = socialSecurityRows(year, ctx, "non_taxable");
  if (ssRows.length > 0) {
    groups.push({ label: "Non-Taxable Social Security", rows: ssRows });
  }

  return groups;
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
  return bySourceRows(year.taxDetail?.bySource ?? {}, type, ctx);
}
