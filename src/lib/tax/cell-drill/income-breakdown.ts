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
 *  Both tax-engine modes now run the same netting (`calculateTaxYearFlat`
 *  gained it alongside `calculateTaxYear`), so `deduction === 0` while the
 *  carryforward is nonzero is no longer reachable: a nonzero carryforward-out
 *  requires shortTermLoss + longTermLoss > 0, which pins
 *  deduction = min(that, limit) > 0. The former flat-mode caveat on the
 *  carryforward row is gone with it. */
function capitalLossRows(
  taxDetail: IncomeCellDrillArgs["year"]["taxDetail"],
  filingStatus: CellDrillContext["filingStatus"],
  /** `netted − raw` for the column being drilled. Non-zero whenever §1222
   *  netting moved the figure the CELL renders away from the raw signed
   *  `taxDetail` total the itemized rows sum to (a prior-year carryforward
   *  applied, or a cross-character offset). Rendered as its own row so the
   *  itemization reconciles to the total instead of contradicting it. */
  nettingAdjustment: number,
): CellDrillRow[] {
  const rows: CellDrillRow[] = [];
  const deduction = taxDetail?.capitalLossDeduction ?? 0;
  const cf = taxDetail?.capitalLossCarryforward;
  const disallowed = taxDetail?.disallowedCapitalLoss ?? 0;
  const limit =
    filingStatus === "married_separate"
      ? CAPITAL_LOSS_ORDINARY_LIMIT_MFS
      : CAPITAL_LOSS_ORDINARY_LIMIT;

  // Rounded to the cent before testing — float noise from the netting
  // arithmetic must not spawn a $0.00 reconciling row.
  if (Math.round(nettingAdjustment * 100) !== 0) {
    rows.push({
      id: "capital-loss-netting",
      label:
        nettingAdjustment < 0
          ? "Offset by capital losses"
          : "Restored by capital-loss netting",
      amount: nettingAdjustment,
      meta: `Difference between the ${formatCurrency(-nettingAdjustment)} of gains itemized above and the net figure taxed this year, after prior-year carryforward and cross-character netting (IRC §1222).`,
    });
  }

  if (deduction > 0) {
    rows.push({
      id: "capital-loss-deduction",
      label: "Capital loss deduction",
      amount: -deduction,
      meta: `Net capital loss offsets ordinary income, limited to ${formatCurrency(limit)} per year (IRC §1211(b)).`,
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
    const raw = (year.taxDetail?.[directCfg.taxDetailKey] as number | undefined) ?? 0;
    const isCapitalGainColumn =
      columnKey === "capitalGains" || columnKey === "shortCapitalGains";
    // i1: for the two capital-gain columns the CELL renders
    // `taxResult.income.capitalGains` / `.shortCapitalGains` — the §1222-NETTED
    // figures, floored at 0. Totalling the raw signed `taxDetail` figure here
    // made the modal contradict the number the advisor clicked: $50,000 of
    // gains against a $30,000 seeded carryover showed a $20,000 cell and a
    // $50,000 modal, every year until the carryover was exhausted. Every other
    // column keeps its taxDetail total (the two agree by construction there).
    const total =
      isCapitalGainColumn && year.taxResult
        ? (year.taxResult.income[columnKey] ?? 0)
        : raw;
    const rows = directRows(year, directCfg.sourceType, ctx);
    const groups: CellDrillProps["groups"] = [{ rows }];
    let footnote: string | undefined;
    if (isCapitalGainColumn) {
      const lossRows = capitalLossRows(year.taxDetail, ctx.filingStatus, total - raw);
      if (lossRows.length > 0) {
        // Separate, labeled group. Only the reconciling `capital-loss-netting`
        // row bridges the itemization to `total`; the deduction offsets
        // ordinary income and the carryforward is a cross-year balance, so
        // neither belongs inside the sum.
        groups.push({ label: "Capital Loss Carryover", rows: lossRows });
        footnote =
          "The itemized gains above plus any “Offset by capital losses” line reconcile to the total. The remaining capital-loss items sit outside it — the deduction offsets ordinary income (not LT/ST gains) and the carryforward is a year-end balance, not income earned this year.";
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
