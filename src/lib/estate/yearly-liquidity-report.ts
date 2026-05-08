import type {
  ClientData,
  DrainAttribution,
  EstateTaxResult,
  HypotheticalEstateTax,
  HypotheticalEstateTaxOrdering,
  ProjectionResult,
  ProjectionYear,
} from "@/engine/types";

export interface YearlyLiquidityReportInput {
  projection: ProjectionResult;
  clientData: ClientData;
  ownerNames: { clientName: string; spouseName: string | null };
  ownerDobs: { clientDob: string | null; spouseDob: string | null };
}

export interface YearlyLiquidityRow {
  year: number;
  ageClient: number | null;
  ageSpouse: number | null;
  insuranceInEstate: number;
  insuranceOutOfEstate: number;
  totalInsuranceBenefit: number;
  totalPortfolioAssets: number;
  totalTransferCost: number;
  surplusDeficitWithPortfolio: number;
  surplusDeficitInsuranceOnly: number;
}

export interface YearlyLiquidityReport {
  rows: YearlyLiquidityRow[];
  totals: {
    insuranceInEstate: number;
    insuranceOutOfEstate: number;
    totalInsuranceBenefit: number;
    totalPortfolioAssets: number;
    totalTransferCost: number;
    surplusDeficitWithPortfolio: number;
    surplusDeficitInsuranceOnly: number;
  };
}

const ZERO_TOTALS: YearlyLiquidityReport["totals"] = {
  insuranceInEstate: 0,
  insuranceOutOfEstate: 0,
  totalInsuranceBenefit: 0,
  totalPortfolioAssets: 0,
  totalTransferCost: 0,
  surplusDeficitWithPortfolio: 0,
  surplusDeficitInsuranceOnly: 0,
};

export function buildYearlyLiquidityReport(
  input: YearlyLiquidityReportInput,
): YearlyLiquidityReport {
  const { projection, ownerDobs } = input;

  const clientBirthYear = parseBirthYear(ownerDobs.clientDob);
  const spouseBirthYear = parseBirthYear(ownerDobs.spouseDob);

  const rows: YearlyLiquidityRow[] = [];
  for (const yearRow of projection.years) {
    const ht = yearRow.hypotheticalEstateTax;
    if (!ht) continue;
    const branch = pickBranch(ht);
    if (!branch) continue;
    rows.push(buildRow({ yearRow, branch, clientBirthYear, spouseBirthYear }));
  }

  const totals = rows.reduce<YearlyLiquidityReport["totals"]>(
    (acc, r) => ({
      insuranceInEstate: acc.insuranceInEstate + r.insuranceInEstate,
      insuranceOutOfEstate: acc.insuranceOutOfEstate + r.insuranceOutOfEstate,
      totalInsuranceBenefit: acc.totalInsuranceBenefit + r.totalInsuranceBenefit,
      totalPortfolioAssets: acc.totalPortfolioAssets + r.totalPortfolioAssets,
      totalTransferCost: acc.totalTransferCost + r.totalTransferCost,
      surplusDeficitWithPortfolio:
        acc.surplusDeficitWithPortfolio + r.surplusDeficitWithPortfolio,
      surplusDeficitInsuranceOnly:
        acc.surplusDeficitInsuranceOnly + r.surplusDeficitInsuranceOnly,
    }),
    { ...ZERO_TOTALS },
  );

  return { rows, totals };
}

interface RowArgs {
  yearRow: ProjectionYear;
  branch: HypotheticalEstateTaxOrdering;
  clientBirthYear: number | null;
  spouseBirthYear: number | null;
}

function buildRow({
  yearRow,
  branch,
  clientBirthYear,
  spouseBirthYear,
}: RowArgs): YearlyLiquidityRow {
  const insuranceInEstate = 0;
  const insuranceOutOfEstate = 0;
  const totalInsuranceBenefit = 0;
  const totalPortfolioAssets = 0;
  const totalTransferCost = transferCost(branch);

  return {
    year: yearRow.year,
    ageClient: clientBirthYear ? yearRow.year - clientBirthYear : null,
    ageSpouse: spouseBirthYear ? yearRow.year - spouseBirthYear : null,
    insuranceInEstate,
    insuranceOutOfEstate,
    totalInsuranceBenefit,
    totalPortfolioAssets,
    totalTransferCost,
    surplusDeficitWithPortfolio:
      totalPortfolioAssets + totalInsuranceBenefit - totalTransferCost,
    surplusDeficitInsuranceOnly: totalInsuranceBenefit - totalTransferCost,
  };
}

function transferCost(branch: HypotheticalEstateTaxOrdering): number {
  return (
    branchDeathCost(branch.firstDeath) +
    (branch.finalDeath ? branchDeathCost(branch.finalDeath) : 0)
  );
}

function branchDeathCost(d: EstateTaxResult): number {
  return d.totalTaxesAndExpenses + sumDrainKind(d.drainAttributions, "ird_tax");
}

function sumDrainKind(
  attributions: DrainAttribution[] | undefined,
  kind: DrainAttribution["drainKind"],
): number {
  if (!attributions) return 0;
  let total = 0;
  for (const a of attributions) {
    if (a.drainKind === kind) total += a.amount;
  }
  return total;
}

function pickBranch(
  ht: HypotheticalEstateTax,
): HypotheticalEstateTaxOrdering | null {
  return ht.primaryFirst ?? ht.spouseFirst ?? null;
}

function parseBirthYear(dob: string | null): number | null {
  if (!dob) return null;
  const y = parseInt(dob.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}
