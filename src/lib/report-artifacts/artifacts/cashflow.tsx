import { createHash } from "node:crypto";
import { z } from "zod";
import type { ReactNode } from "react";
import type { ReportArtifact, FetchDataResult, RenderPdfInput, CsvFile } from "../types";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjection } from "@/engine";
import type { ProjectionYear, ClientData } from "@/engine";

export const optionsSchema = z.object({
  scenarioId: z.string().nullable().default(null),
  yearStart: z.number().int().nullable().default(null),
  yearEnd: z.number().int().nullable().default(null),
});
export type CashflowOptions = z.infer<typeof optionsSchema>;

export type CashflowSectionId = "base" | "income" | "expenses" | "withdrawals" | "assets";

export type CashflowSection = {
  id: CashflowSectionId;
  title: string;
  headers: { id: string; label: string; align: "left" | "right" }[];
  rows: CashflowRow[];
  totals: Record<string, number>;
};

export type CashflowRow = {
  year: number;
  age: string;
  cells: Record<string, number>;
};

export type CashflowData = {
  clientName: string;
  scenarioLabel: string;
  yearRange: [number, number];
  sections: Record<CashflowSectionId, CashflowSection>;
};

async function fetchCashflowData(
  clientId: string,
  firmId: string,
  opts: CashflowOptions,
): Promise<FetchDataResult<CashflowData>> {
  const scenarioParam = opts.scenarioId ?? "base";
  const { effectiveTree } = await loadEffectiveTree(clientId, firmId, scenarioParam, {});
  const allYears = runProjection(effectiveTree);

  const yearStart = opts.yearStart ?? allYears[0]?.year ?? 0;
  const yearEnd = opts.yearEnd ?? allYears[allYears.length - 1]?.year ?? yearStart;
  const years = allYears.filter((y) => y.year >= yearStart && y.year <= yearEnd);

  const data: CashflowData = {
    clientName: clientName(effectiveTree),
    scenarioLabel: opts.scenarioId ? `Scenario ${opts.scenarioId}` : "Base Case",
    yearRange: [yearStart, yearEnd],
    sections: {
      base: buildBaseSection(years, effectiveTree),
      income: buildIncomeSection(years, effectiveTree),
      expenses: buildExpensesSection(years, effectiveTree),
      withdrawals: buildWithdrawalsSection(years, effectiveTree),
      assets: buildAssetsSection(years, effectiveTree),
    },
  };

  const dataVersion = createHash("sha1")
    .update(JSON.stringify(data))
    .digest("hex")
    .slice(0, 16);

  return { data, asOf: new Date(), dataVersion };
}

function clientName(c: ClientData): string {
  return `${c.client.firstName ?? ""} ${c.client.lastName ?? ""}`.trim() || "Client";
}

function ageString(year: ProjectionYear, c: ClientData): string {
  const clientLE = c.client.lifeExpectancy ?? 95;
  const spouseLE = c.client.spouseLifeExpectancy ?? 95;
  const clientStr = year.ages.client > clientLE ? "—" : String(year.ages.client);
  if (year.ages.spouse == null) return clientStr;
  const spouseStr = year.ages.spouse > spouseLE ? "—" : String(year.ages.spouse);
  return `${clientStr} / ${spouseStr}`;
}

function liquidPortfolioTotal(y: ProjectionYear): number {
  return (
    y.portfolioAssets.taxableTotal +
    y.portfolioAssets.cashTotal +
    y.portfolioAssets.retirementTotal +
    y.portfolioAssets.lifeInsuranceTotal
  );
}

function buildBaseSection(years: ProjectionYear[], c: ClientData): CashflowSection {
  const headers: CashflowSection["headers"] = [
    { id: "year", label: "Year", align: "left" },
    { id: "age", label: "Age(s)", align: "left" },
    { id: "totalIncome", label: "Income", align: "right" },
    { id: "totalExpenses", label: "Expenses", align: "right" },
    { id: "netCashFlow", label: "Net Cash Flow", align: "right" },
    { id: "portfolioTotal", label: "Portfolio", align: "right" },
  ];
  const rows: CashflowRow[] = years.map((y) => ({
    year: y.year,
    age: ageString(y, c),
    cells: {
      totalIncome: y.totalIncome,
      totalExpenses: y.totalExpenses,
      netCashFlow: y.netCashFlow,
      portfolioTotal: liquidPortfolioTotal(y),
    },
  }));
  const last = years[years.length - 1];
  const totals: Record<string, number> = {
    totalIncome: years.reduce((s, y) => s + y.totalIncome, 0),
    totalExpenses: years.reduce((s, y) => s + y.totalExpenses, 0),
    netCashFlow: years.reduce((s, y) => s + y.netCashFlow, 0),
    portfolioTotal: last ? liquidPortfolioTotal(last) : 0,
  };
  return { id: "base", title: "Cash Flow — Summary", headers, rows, totals };
}

function buildIncomeSection(years: ProjectionYear[], c: ClientData): CashflowSection {
  const headers: CashflowSection["headers"] = [
    { id: "year", label: "Year", align: "left" },
    { id: "age", label: "Age(s)", align: "left" },
    { id: "salaries", label: "Salaries", align: "right" },
    { id: "socialSecurity", label: "Social Security", align: "right" },
    { id: "business", label: "Business", align: "right" },
    { id: "trust", label: "Trust", align: "right" },
    { id: "deferred", label: "Deferred", align: "right" },
    { id: "capitalGains", label: "Capital Gains", align: "right" },
    { id: "other", label: "Other", align: "right" },
    { id: "total", label: "Total", align: "right" },
  ];
  const rows: CashflowRow[] = years.map((y) => ({
    year: y.year,
    age: ageString(y, c),
    cells: {
      salaries: y.income.salaries,
      socialSecurity: y.income.socialSecurity,
      business: y.income.business,
      trust: y.income.trust,
      deferred: y.income.deferred,
      capitalGains: y.income.capitalGains,
      other: y.income.other,
      total: y.income.total,
    },
  }));
  const totals: Record<string, number> = {};
  for (const id of ["salaries", "socialSecurity", "business", "trust", "deferred", "capitalGains", "other", "total"]) {
    totals[id] = years.reduce((s, y) => s + (y.income[id as keyof typeof y.income] as number), 0);
  }
  return { id: "income", title: "Income Detail", headers, rows, totals };
}

function buildExpensesSection(years: ProjectionYear[], c: ClientData): CashflowSection {
  const headers: CashflowSection["headers"] = [
    { id: "year", label: "Year", align: "left" },
    { id: "age", label: "Age(s)", align: "left" },
    { id: "living", label: "Living", align: "right" },
    { id: "liabilities", label: "Liabilities", align: "right" },
    { id: "other", label: "Other", align: "right" },
    { id: "insurance", label: "Insurance", align: "right" },
    { id: "realEstate", label: "Real Estate", align: "right" },
    { id: "taxes", label: "Taxes", align: "right" },
    { id: "total", label: "Total", align: "right" },
  ];
  const rows: CashflowRow[] = years.map((y) => ({
    year: y.year,
    age: ageString(y, c),
    cells: {
      living: y.expenses.living,
      liabilities: y.expenses.liabilities,
      other: y.expenses.other,
      insurance: y.expenses.insurance,
      realEstate: y.expenses.realEstate,
      taxes: y.expenses.taxes,
      total: y.expenses.total,
    },
  }));
  const totals: Record<string, number> = {};
  for (const id of ["living", "liabilities", "other", "insurance", "realEstate", "taxes", "total"]) {
    totals[id] = years.reduce((s, y) => s + (y.expenses[id as keyof typeof y.expenses] as number), 0);
  }
  return { id: "expenses", title: "Expenses Detail", headers, rows, totals };
}

function portfolioAccountIds(r: ProjectionYear): string[] {
  const ids = new Set<string>();
  for (const bucket of ["taxable", "cash", "retirement", "realEstate", "business", "lifeInsurance"] as const) {
    const byAcct = r.portfolioAssets[bucket];
    for (const id of Object.keys(byAcct)) ids.add(id);
  }
  return Array.from(ids);
}

function portfolioGrowthTotal(r: ProjectionYear): number {
  let sum = 0;
  for (const id of portfolioAccountIds(r)) sum += r.accountLedgers[id]?.growth ?? 0;
  return sum;
}

function additionsTotal(r: ProjectionYear): number {
  let sum = 0;
  for (const id of portfolioAccountIds(r)) {
    const led = r.accountLedgers[id];
    if (!led) continue;
    sum += led.contributions - (led.internalContributions ?? 0);
  }
  return sum;
}

function distributionsTotal(r: ProjectionYear): number {
  let sum = 0;
  for (const id of portfolioAccountIds(r)) {
    const led = r.accountLedgers[id];
    if (!led) continue;
    sum += led.distributions - (led.internalDistributions ?? 0);
  }
  return sum;
}

function buildWithdrawalsSection(years: ProjectionYear[], c: ClientData): CashflowSection {
  const headers: CashflowSection["headers"] = [
    { id: "year", label: "Year", align: "left" },
    { id: "age", label: "Age(s)", align: "left" },
    { id: "growth", label: "Portfolio Growth", align: "right" },
    { id: "additions", label: "Additions", align: "right" },
    { id: "distributions", label: "Distributions", align: "right" },
    { id: "netCashFlow", label: "Net Cash Flow", align: "right" },
  ];
  const rows: CashflowRow[] = years.map((y) => ({
    year: y.year,
    age: ageString(y, c),
    cells: {
      growth: portfolioGrowthTotal(y),
      additions: additionsTotal(y),
      distributions: distributionsTotal(y),
      netCashFlow: y.netCashFlow,
    },
  }));
  const totals: Record<string, number> = {
    growth: rows.reduce((s, r) => s + r.cells.growth, 0),
    additions: rows.reduce((s, r) => s + r.cells.additions, 0),
    distributions: rows.reduce((s, r) => s + r.cells.distributions, 0),
    netCashFlow: rows.reduce((s, r) => s + r.cells.netCashFlow, 0),
  };
  return { id: "withdrawals", title: "Net Cash Flow Detail", headers, rows, totals };
}

function buildAssetsSection(years: ProjectionYear[], c: ClientData): CashflowSection {
  const headers: CashflowSection["headers"] = [
    { id: "year", label: "Year", align: "left" },
    { id: "age", label: "Age(s)", align: "left" },
    { id: "taxable", label: "Taxable", align: "right" },
    { id: "cash", label: "Cash", align: "right" },
    { id: "retirement", label: "Retirement", align: "right" },
    { id: "realEstate", label: "Real Estate", align: "right" },
    { id: "business", label: "Business", align: "right" },
    { id: "lifeInsurance", label: "Life Insurance", align: "right" },
    { id: "trustsAndBusinesses", label: "Trusts/Businesses", align: "right" },
    { id: "accessibleTrustAssets", label: "Accessible Trusts", align: "right" },
    { id: "total", label: "Total", align: "right" },
  ];
  const rows: CashflowRow[] = years.map((y) => ({
    year: y.year,
    age: ageString(y, c),
    cells: {
      taxable: y.portfolioAssets.taxableTotal,
      cash: y.portfolioAssets.cashTotal,
      retirement: y.portfolioAssets.retirementTotal,
      realEstate: y.portfolioAssets.realEstateTotal,
      business: y.portfolioAssets.businessTotal,
      lifeInsurance: y.portfolioAssets.lifeInsuranceTotal,
      trustsAndBusinesses: y.portfolioAssets.trustsAndBusinessesTotal,
      accessibleTrustAssets: y.portfolioAssets.accessibleTrustAssetsTotal,
      total: y.portfolioAssets.total,
    },
  }));
  const last = years[years.length - 1];
  const totals: Record<string, number> = last ? {
    taxable: last.portfolioAssets.taxableTotal,
    cash: last.portfolioAssets.cashTotal,
    retirement: last.portfolioAssets.retirementTotal,
    realEstate: last.portfolioAssets.realEstateTotal,
    business: last.portfolioAssets.businessTotal,
    lifeInsurance: last.portfolioAssets.lifeInsuranceTotal,
    trustsAndBusinesses: last.portfolioAssets.trustsAndBusinessesTotal,
    accessibleTrustAssets: last.portfolioAssets.accessibleTrustAssetsTotal,
    total: last.portfolioAssets.total,
  } : {};
  return { id: "assets", title: "Portfolio Detail", headers, rows, totals };
}

function renderCashflowPdf(_input: RenderPdfInput<CashflowData, CashflowOptions>): ReactNode {
  throw new Error("not implemented");
}

function cashflowToCsv(_data: CashflowData, _opts: CashflowOptions): CsvFile[] {
  throw new Error("not implemented");
}

export const cashflowArtifact: ReportArtifact<CashflowData, typeof optionsSchema> = {
  id: "cashflow",
  title: "Cash Flow",
  section: "cashflow",
  route: "/clients/[id]/cashflow",
  variants: ["chart", "data", "chart+data", "csv"],
  optionsSchema,
  defaultOptions: { scenarioId: null, yearStart: null, yearEnd: null },
  fetchData: ({ clientId, firmId, opts }) => fetchCashflowData(clientId, firmId, opts),
  renderPdf: renderCashflowPdf,
  toCsv: cashflowToCsv,
};
