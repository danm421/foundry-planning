import { createHash } from "node:crypto";
import { z } from "zod";
import type { ReactNode } from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { DataTable } from "@/components/reports-pdf/widgets/data-table";
import { ChartImage } from "@/components/reports-pdf/widgets/chart-image";
import { PDF_THEME } from "@/components/reports-pdf/theme";
import type { ReportArtifact, FetchDataResult, RenderPdfInput, CsvFile, ChartImage as ChartImageType } from "../types";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjection } from "@/engine";
import type { ProjectionYear, ClientData } from "@/engine";
import { serializeCsv } from "../csv";

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
  headers: { id: string; label: string; align: "left" | "right"; format?: "money" | "percent" }[];
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
  // Mirrors the Level-0 columns of the on-screen cashflow table — see
  // cashflow-report.tsx around the `if (!level)` branch.
  const techniqueIncomeIds = (c.assetTransactions ?? [])
    .filter((t) => t.type === "sell")
    .map((t) => `technique-proceeds:${t.id}`);

  const rmdsTotal = (y: ProjectionYear) =>
    Object.values(y.accountLedgers).reduce((s, l) => s + l.rmdAmount, 0);
  const otherInflowsTotal = (y: ProjectionYear) =>
    techniqueIncomeIds.reduce((s, id) => s + (y.income.bySource[id] ?? 0), 0);

  const headers: CashflowSection["headers"] = [
    { id: "year", label: "Year", align: "left" },
    { id: "age", label: "Age(s)", align: "left" },
    { id: "income", label: "Income", align: "right" },
    { id: "rmds", label: "RMDs", align: "right" },
    { id: "otherInflows", label: "Other Inflows", align: "right" },
    { id: "totalIncome", label: "Total Income", align: "right" },
    { id: "expenses", label: "Expenses", align: "right" },
    { id: "savings", label: "Savings", align: "right" },
    { id: "totalExpenses", label: "Total Expenses", align: "right" },
    { id: "netCashFlow", label: "Net Cash Flow", align: "right" },
    { id: "portfolioGrowth", label: "Portfolio Growth", align: "right" },
    { id: "portfolioActivity", label: "Portfolio Activity", align: "right" },
    { id: "portfolioAssets", label: "Portfolio Assets", align: "right" },
  ];
  const rows: CashflowRow[] = years.map((y) => ({
    year: y.year,
    age: ageString(y, c),
    cells: {
      income: y.income.total,
      rmds: rmdsTotal(y),
      otherInflows: otherInflowsTotal(y),
      totalIncome: y.totalIncome,
      expenses: y.expenses.total,
      savings: y.savings.total,
      totalExpenses: y.totalExpenses,
      netCashFlow: y.netCashFlow,
      portfolioGrowth: portfolioGrowthTotal(y),
      portfolioActivity: additionsTotal(y) - distributionsTotal(y),
      portfolioAssets: liquidPortfolioTotal(y),
    },
  }));
  const last = years[years.length - 1];
  const sum = (key: string) => rows.reduce((s, r) => s + (r.cells[key] ?? 0), 0);
  const totals: Record<string, number> = {
    income: sum("income"),
    rmds: sum("rmds"),
    otherInflows: sum("otherInflows"),
    totalIncome: sum("totalIncome"),
    expenses: sum("expenses"),
    savings: sum("savings"),
    totalExpenses: sum("totalExpenses"),
    netCashFlow: sum("netCashFlow"),
    portfolioGrowth: sum("portfolioGrowth"),
    portfolioActivity: sum("portfolioActivity"),
    // Portfolio Assets is a balance, not a flow — end-of-period value.
    portfolioAssets: last ? liquidPortfolioTotal(last) : 0,
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

// Mirrors the on-screen Net Cash Flow drill-down (cashflow-report.tsx, the
// `level === "cashflow"` branch). Per-category withdrawal columns appear only
// for categories that actually had a household-supplemental withdrawal across
// the visible range, then a Total / BoY portfolio / withdrawal-% summary.
const WITHDRAWAL_CATEGORIES: { key: string; label: string }[] = [
  { key: "cash", label: "Cash Assets" },
  { key: "taxable", label: "Taxable Assets" },
  { key: "retirement", label: "Retirement" },
  { key: "real_estate", label: "Real Estate" },
  { key: "business", label: "Business" },
  { key: "life_insurance", label: "Life Insurance" },
];

const PORTFOLIO_BUCKET_TO_CATEGORY: Record<string, string> = {
  taxable: "taxable",
  cash: "cash",
  retirement: "retirement",
  realEstate: "real_estate",
  business: "business",
  lifeInsurance: "life_insurance",
};

function buildAccountCategoryMap(
  years: ProjectionYear[],
  c: ClientData,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const acc of c.accounts ?? []) map[acc.id] = acc.category;
  // Synthetic accounts minted by the engine (asset-purchase techniques) aren't
  // in ClientData.accounts — recover their categories from portfolio buckets.
  for (const y of years) {
    for (const [bucket, category] of Object.entries(PORTFOLIO_BUCKET_TO_CATEGORY)) {
      const buckets = y.portfolioAssets as unknown as Record<string, Record<string, number> | undefined>;
      const byAcct = buckets[bucket];
      if (!byAcct) continue;
      for (const id of Object.keys(byAcct)) if (!(id in map)) map[id] = category;
    }
  }
  return map;
}

function portfolioBoy(year: ProjectionYear, years: ProjectionYear[]): number {
  const prev = years.find((y) => y.year === year.year - 1);
  if (prev) return prev.portfolioAssets.total;
  return Object.values(year.accountLedgers).reduce(
    (s, l) => s + (l?.beginningValue ?? 0),
    0,
  );
}

function buildWithdrawalsSection(years: ProjectionYear[], c: ClientData): CashflowSection {
  const accountCategoryById = buildAccountCategoryMap(years, c);
  const withdrawalCategoriesUsed = new Set<string>();
  for (const y of years) {
    for (const id of Object.keys(y.withdrawals.byAccount)) {
      const cat = accountCategoryById[id];
      if (cat) withdrawalCategoriesUsed.add(cat);
    }
  }
  const usedCategories = WITHDRAWAL_CATEGORIES.filter((c) => withdrawalCategoriesUsed.has(c.key));

  const headers: CashflowSection["headers"] = [
    { id: "year", label: "Year", align: "left" },
    { id: "age", label: "Age(s)", align: "left" },
    ...usedCategories.map((c) => ({
      id: c.key,
      label: c.label,
      align: "right" as const,
    })),
    { id: "totalWithdrawals", label: "Total Withdrawals", align: "right" },
    { id: "portfolioBoY", label: "Portfolio (BoY)", align: "right" },
    { id: "withdrawalPct", label: "Withdrawal %", align: "right", format: "percent" },
  ];

  const withdrawalByCategory = (r: ProjectionYear, category: string): number => {
    let sum = 0;
    for (const [id, amt] of Object.entries(r.withdrawals.byAccount)) {
      if (accountCategoryById[id] === category) sum += amt;
    }
    return sum;
  };

  const rows: CashflowRow[] = years.map((y) => {
    const boy = portfolioBoy(y, years);
    const rmdTotal = Object.values(y.accountLedgers ?? {}).reduce(
      (s, l) => s + (l?.rmdAmount ?? 0),
      0,
    );
    const cells: Record<string, number> = {};
    for (const c of usedCategories) cells[c.key] = withdrawalByCategory(y, c.key);
    cells.totalWithdrawals = y.withdrawals.total;
    cells.portfolioBoY = boy;
    // RMDs ride in the numerator alongside supplemental withdrawals — matches
    // the on-screen "Withdrawal %" column (cashflow-report.tsx:1738).
    cells.withdrawalPct = boy > 0 ? (y.withdrawals.total + rmdTotal) / boy : 0;
    return { year: y.year, age: ageString(y, c), cells };
  });

  // Totals: sums for money flows; BoY and Withdrawal % don't aggregate cleanly,
  // so they're omitted (the row accessor renders missing keys as blank).
  const totals: Record<string, number> = {};
  for (const cat of usedCategories) {
    totals[cat.key] = rows.reduce((s, r) => s + (r.cells[cat.key] ?? 0), 0);
  }
  totals.totalWithdrawals = rows.reduce((s, r) => s + r.cells.totalWithdrawals, 0);
  return { id: "withdrawals", title: "Withdrawals", headers, rows, totals };
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

const pdfStyles = StyleSheet.create({
  sectionTitle: { fontSize: 13, fontWeight: 700, marginTop: 12, marginBottom: 4 },
  scenarioLine: { fontSize: 10, color: PDF_THEME.ink2, marginBottom: 8 },
  break: { marginTop: 8 },
});

// 0 renders as em-dash in compact PDF context; on-screen tables show "$0".
function fmtMoneyCompact(n: number): string {
  if (n === 0) return "—";
  const abs = Math.abs(n);
  let formatted: string;
  if (abs >= 1_000_000_000) formatted = `$${(abs / 1_000_000_000).toFixed(1)}B`;
  else if (abs >= 1_000_000) formatted = `$${(abs / 1_000_000).toFixed(1)}M`;
  else if (abs >= 1_000) formatted = `$${(abs / 1_000).toFixed(0)}K`;
  else formatted = `$${abs.toFixed(0)}`;
  return n < 0 ? `(${formatted})` : formatted;
}

const SECTION_ORDER: CashflowSectionId[] = ["base", "income", "expenses", "withdrawals", "assets"];

function renderSection(
  data: CashflowData,
  sectionId: CashflowSectionId,
  variant: RenderPdfInput<CashflowData, CashflowOptions>["variant"],
  charts: ChartImageType[],
  isFirst: boolean,
): ReactNode {
  const showCharts = variant === "chart" || variant === "chart+data";
  const showData = variant === "data" || variant === "chart+data";
  const section = data.sections[sectionId];
  if (section.rows.length === 0) return null;

  const sectionChart =
    sectionId === "base"
      ? (charts.find((c) => c.id === "base-cashflow") ?? charts.find((c) => c.id === "base-portfolio"))
      : charts.find((c) => c.id === sectionId);

  const ageByYear = new Map(data.sections.base.rows.map((r) => [r.year, r.age]));
  const rowsWithAge = section.rows.map((r) => ({
    ...r,
    age: r.age || (ageByYear.get(r.year) ?? ""),
  }));

  // Year / age headers don't need an equal share of the row — pinning them to
  // narrow fixed widths frees up space for the money columns so wider headers
  // (Social Security, Trusts/Businesses, Real Estate) stop wrapping awkwardly.
  const FIXED_WIDTHS: Record<string, number> = { year: 7, age: 10 };
  const fixedTotal = section.headers.reduce(
    (sum, h) => sum + (FIXED_WIDTHS[h.id] ?? 0),
    0,
  );
  const flexCount = section.headers.filter((h) => !FIXED_WIDTHS[h.id]).length;
  const flexWidth = flexCount > 0 ? (100 - fixedTotal) / flexCount : 0;

  const columns = section.headers.map((h) => ({
    header: h.label,
    align: h.align,
    width: `${FIXED_WIDTHS[h.id] ?? flexWidth}%`,
    accessor: (row: typeof rowsWithAge[number]) => {
      if (h.id === "year") return String(row.year);
      if (h.id === "age") return row.age;
      const v = row.cells[h.id];
      if (typeof v !== "number") return "";
      if (h.format === "percent") return `${(v * 100).toFixed(2)}%`;
      return fmtMoneyCompact(v);
    },
  }));

  const footerRow: typeof rowsWithAge[number] = {
    year: 0,
    age: "TOTAL",
    cells: section.totals,
  };

  return (
    <View key={sectionId} break={!isFirst} style={isFirst ? undefined : pdfStyles.break}>
      <Text style={pdfStyles.sectionTitle}>{section.title}</Text>
      {isFirst && (
        <Text style={pdfStyles.scenarioLine}>
          {data.scenarioLabel} · Years {data.yearRange[0]}–{data.yearRange[1]}
        </Text>
      )}
      {showCharts && sectionChart && <ChartImage chart={sectionChart} maxWidth={480} />}
      {showData && (
        <DataTable
          columns={columns}
          rows={rowsWithAge}
          footerRow={footerRow}
          compact={section.headers.length >= 10}
        />
      )}
    </View>
  );
}

function renderCashflowPdf({ data, variant, charts }: RenderPdfInput<CashflowData, CashflowOptions>): ReactNode {
  return (
    <View>
      {SECTION_ORDER.map((id, idx) => renderSection(data, id, variant, charts, idx === 0))}
    </View>
  );
}

function fmtCsvCell(v: number, format?: "money" | "percent"): string {
  if (format === "percent") return v.toFixed(4);
  return String(Math.round(v));
}

function sectionToCsv(section: CashflowSection, ageByYear: Map<number, string>): string {
  if (section.rows.length === 0) return "";
  const headerLabels = section.headers.map((h) => h.label);
  const bodyRows = section.rows.map((r) => {
    return section.headers.map((h) => {
      if (h.id === "year") return String(r.year);
      if (h.id === "age") return r.age || (ageByYear.get(r.year) ?? "");
      const v = r.cells[h.id];
      return typeof v === "number" ? fmtCsvCell(v, h.format) : "";
    });
  });
  const totalsRow = section.headers.map((h, i) => {
    if (i === 0) return "TOTAL";
    if (h.id === "age") return "";
    const v = section.totals[h.id];
    return typeof v === "number" ? fmtCsvCell(v, h.format) : "";
  });
  return serializeCsv([headerLabels, ...bodyRows, totalsRow]);
}

function cashflowToCsv(data: CashflowData, _opts: CashflowOptions): CsvFile[] {
  const ageByYear = new Map(data.sections.base.rows.map((r) => [r.year, r.age]));
  const out: CsvFile[] = [];
  for (const id of SECTION_ORDER) {
    const section = data.sections[id];
    if (section.rows.length === 0) continue;
    out.push({ name: `cashflow-${id}.csv`, contents: sectionToCsv(section, ageByYear) });
  }
  return out;
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
