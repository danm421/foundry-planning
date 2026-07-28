import type {
  CellDrillContext,
  CellDrillProps,
  CellDrillRow,
  IncomeCellDrillArgs,
  IncomeColumnKey,
} from "./types";
import { bySourceRows, formatCurrency, resolveSourceLabel } from "./_shared";
import {
  CAPITAL_LOSS_ORDINARY_LIMIT,
  CAPITAL_LOSS_ORDINARY_LIMIT_MFS,
} from "@/lib/tax/constants";

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

/** Capital-loss rows shown in their own group, separate from the LT/ST
 *  capital-gain rows that sum to `total`. Without these the §1211(b) cap is
 *  invisible and a large loss producing only a $3,000 deduction reads as a
 *  bug.
 *
 *  These rows deliberately do NOT roll into the LT/ST gain group: the
 *  deduction offsets ORDINARY income (Form 1040 line 7), not LT/ST capital
 *  gains, and the carryforward is a cross-year BALANCE, not a this-year
 *  flow. See `buildIncomeCellDrill`'s caller, which puts them in a labeled
 *  sibling group with a footnote rather than appending them to `rows`.
 *
 *  Uses `ctx.filingStatus` to pick the $3,000 vs $1,500(MFS) §1211(b) limit;
 *  falls back to the non-MFS limit when filing status isn't populated by the
 *  caller (not every caller threads it through yet).
 *
 *  Known gap: in flat tax-engine mode (`PlanSettings.taxEngineMode`, not
 *  reachable here — not on `ProjectionYear`, `TaxResult`, or
 *  `CellDrillContext`) `capitalLossDeduction` is always 0 and the
 *  carryforward balance never moves year to year. The carryforward row's
 *  `meta` calls this out when `deduction === 0` so it doesn't read as a
 *  stalled paydown. */
function capitalLossRows(
  taxDetail: IncomeCellDrillArgs["year"]["taxDetail"],
  filingStatus: CellDrillContext["filingStatus"],
): CellDrillRow[] {
  const rows: CellDrillRow[] = [];
  const deduction = taxDetail?.capitalLossDeduction ?? 0;
  const cf = taxDetail?.capitalLossCarryforward;
  const disallowed = taxDetail?.disallowedCapitalLoss ?? 0;
  const limit =
    filingStatus === "married_separate"
      ? CAPITAL_LOSS_ORDINARY_LIMIT_MFS
      : CAPITAL_LOSS_ORDINARY_LIMIT;

  if (deduction > 0) {
    rows.push({
      id: "capital-loss-deduction",
      label: "Capital loss deduction",
      amount: -deduction,
      meta: `Net capital loss offsets ordinary income, limited to ${formatCurrency(limit)} per year (IRC §1211(b)).`,
    });
  }

  if (cf && (cf.shortTerm > 0 || cf.longTerm > 0)) {
    // deduction === 0 while cf > 0 only happens in flat tax-engine mode —
    // in bracket mode a nonzero carryforward-out requires a net loss that
    // exceeded the annual limit, which always pins deduction at the limit.
    const flatModeCaveat =
      deduction === 0
        ? " No offset against ordinary income was applied this year."
        : "";
    rows.push({
      id: "capital-loss-carryforward",
      label: "Loss carried to next year",
      amount: cf.shortTerm + cf.longTerm,
      meta: `${formatCurrency(cf.shortTerm)} short-term, ${formatCurrency(cf.longTerm)} long-term. Carries forward indefinitely (IRC §1212(b)).${flatModeCaveat}`,
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
    const groups: CellDrillProps["groups"] = [{ rows }];
    let footnote: string | undefined;
    if (columnKey === "capitalGains" || columnKey === "shortCapitalGains") {
      const lossRows = capitalLossRows(year.taxDetail, ctx.filingStatus);
      if (lossRows.length > 0) {
        // Separate, labeled group — these rows do NOT sum into `total` (the
        // deduction offsets ordinary income, and the carryforward is a
        // cross-year balance), so they must not silently break the
        // sum(rows) === total invariant the main group upholds.
        groups.push({ label: "Capital Loss Carryover", rows: lossRows });
        footnote =
          "Capital-loss items above sit outside the total — the deduction offsets ordinary income (not LT/ST gains) and the carryforward is a year-end balance, not income earned this year.";
      }
    }
    return { title, total, groups, footnote };
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
