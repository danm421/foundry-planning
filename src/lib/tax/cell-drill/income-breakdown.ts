import type {
  CellDrillProps,
  CellDrillRow,
  IncomeCellDrillArgs,
  IncomeColumnKey,
} from "./types";
import { bySourceRows, formatCurrency, resolveSourceLabel } from "./_shared";
import { CAPITAL_LOSS_ORDINARY_LIMIT } from "@/lib/tax/constants";

const COLUMN_LABEL: Record<IncomeColumnKey, string> = {
  earnedIncome: "Earned Income",
  taxableSocialSecurity: "Taxable Social Security",
  ordinaryIncome: "Ordinary Income",
  dividends: "Dividends",
  capitalGains: "LT Capital Gains",
  shortCapitalGains: "ST Capital Gains",
  qbi: "QBI",
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
  qbi:               { sourceType: "qbi",              taxDetailKey: "qbi" },
};

/** Capital-loss rows appended to the LT/ST capital-gain drill-downs. Without
 *  these the §1211(b) cap is invisible and a large loss producing only a
 *  $3,000 deduction reads as a bug.
 *
 *  Uses the flat (non-MFS) limit unconditionally: filing status is not part
 *  of `IncomeCellDrillArgs` (not on `ProjectionYear`, `TaxResult`, or
 *  `CellDrillContext`) and threading a new argument through both callers
 *  just for a tooltip is not worth it — MFS is rare enough that a wrong
 *  limit in a tooltip is a smaller defect.
 *
 *  Known gap: in flat tax-engine mode (`PlanSettings.taxEngineMode`, also
 *  not reachable here) `capitalLossDeduction` is always 0 and this
 *  carryforward balance never moves year to year, so it can read as a
 *  stalled paydown rather than "not modeled in flat mode." Left unfixed —
 *  detecting flat mode would require the same kind of new plumbing. */
function capitalLossRows(taxDetail: IncomeCellDrillArgs["year"]["taxDetail"]): CellDrillRow[] {
  const rows: CellDrillRow[] = [];
  const deduction = taxDetail?.capitalLossDeduction ?? 0;
  const cf = taxDetail?.capitalLossCarryforward;
  const disallowed = taxDetail?.disallowedCapitalLoss ?? 0;

  if (deduction > 0) {
    rows.push({
      id: "capital-loss-deduction",
      label: "Capital loss deduction",
      amount: -deduction,
      meta: `Net capital loss offsets ordinary income, limited to ${formatCurrency(CAPITAL_LOSS_ORDINARY_LIMIT)} per year (IRC §1211(b)).`,
    });
  }

  if (cf && (cf.shortTerm > 0 || cf.longTerm > 0)) {
    rows.push({
      id: "capital-loss-carryforward",
      label: "Loss carried to next year",
      amount: cf.shortTerm + cf.longTerm,
      meta: `${formatCurrency(cf.shortTerm)} short-term, ${formatCurrency(cf.longTerm)} long-term. Carries forward indefinitely (IRC §1212(b)).`,
    });
  }

  if (disallowed > 0) {
    rows.push({
      id: "capital-loss-disallowed",
      label: "Capital loss — not deductible",
      amount: 0,
      meta: `${formatCurrency(disallowed)} loss on a personal residence. A loss on personal-use property is not deductible (IRC §165(c)).`,
    });
  }

  return rows;
}

export function buildIncomeCellDrill(args: IncomeCellDrillArgs): CellDrillProps {
  const { year, columnKey, ctx } = args;
  const title = `${COLUMN_LABEL[columnKey]} — ${year.year}`;

  const directCfg = DIRECT_CONFIG[columnKey];
  if (directCfg) {
    const total = (year.taxDetail?.[directCfg.taxDetailKey] as number | undefined) ?? 0;
    const rows = directRows(year, directCfg.sourceType, ctx);
    if (columnKey === "capitalGains" || columnKey === "shortCapitalGains") {
      rows.push(...capitalLossRows(year.taxDetail));
    }
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
  push("QBI", directRows(year, "qbi", ctx));
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

  const taxFreeRows = directRows(year, "tax_free", ctx);
  if (taxFreeRows.length > 0) {
    groups.push({ label: "Tax-Free Retirement Distributions", rows: taxFreeRows });
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
