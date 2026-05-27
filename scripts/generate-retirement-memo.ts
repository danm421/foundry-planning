/**
 * Dump base-case vs proposed-scenario comparison JSON for the retirement memo
 * PDF builder.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/generate-retirement-memo.ts \
 *     --client 877a9532-f8ea-49b0-9db7-aadd64fab82a \
 *     --proposed 0ad72691-4390-44ab-9f8d-0ee00d5c8c7c \
 *     --out scripts/retirement-memo-data.json
 *
 * Reads .env.local, bypasses auth, runs the projection engine + Monte Carlo
 * for both base case and the named proposed scenario, then emits a JSON file
 * the Python PDF builder can read. Defaults to the Cooper & Susan Sample
 * client + Retirement Plan scenario when --client / --proposed are omitted.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

// Load .env.local without runtime dep.
try {
  const envFile = readFileSync(resolvePath(process.cwd(), ".env.local"), "utf8");
  for (const line of envFile.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k]) continue;
    let v = raw.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[k] = v;
  }
} catch {}

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  accounts,
  clients,
  crmHouseholdContacts,
  expenses,
  incomes,
  liabilities,
  modelPortfolios,
  scenarioChanges,
  scenarios,
} from "../src/db/schema";
import { runProjectionWithEvents } from "../src/engine/projection";
import { loadEffectiveTree } from "../src/lib/scenario/loader";
import { getMonteCarloResult } from "../src/lib/projection/get-monte-carlo-result";
import type { ProjectionYear } from "../src/engine/types";

// ─── arg parsing ──────────────────────────────────────────────────────
function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.findIndex((a) => a === `--${name}`);
  if (i < 0) return fallback;
  return process.argv[i + 1];
}

const CLIENT_ID = arg("client") ?? "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const PROPOSED_ID = arg("proposed") ?? "0ad72691-4390-44ab-9f8d-0ee00d5c8c7c";
const OUT_PATH = arg("out") ?? "scripts/retirement-memo-data.json";

// ─── helpers ──────────────────────────────────────────────────────────
function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function ageAt(year: number, dob: Date | null | undefined): number | null {
  if (!dob) return null;
  return year - dob.getFullYear();
}

interface SummaryRow {
  year: number;
  age: number;
  spouseAge: number | null;
  totalPortfolio: number;
  liquidPortfolio: number;
  retirementTotal: number;
  taxableTotal: number;
  cashTotal: number;
  realEstateTotal: number;
  businessTotal: number;
  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;
  taxes: number;
  withdrawals: number;
  rothConversionTaxable: number;
  ssIncome: number;
  salaries: number;
  otherInflows: number;
  rmds: number;
  living: number;
  insurance: number;
}

function summarizeYear(y: ProjectionYear, dob: Date | null, spouseDob: Date | null | undefined): SummaryRow {
  const liquid =
    y.portfolioAssets.taxableTotal +
    y.portfolioAssets.cashTotal +
    y.portfolioAssets.retirementTotal;
  const rothTaxable = sum((y.rothConversions ?? []).map((r) => r.taxable));
  // Mirrors the in-app Cash Flow chart segmentation
  // (src/components/cashflow-report.tsx :: cashflowChartData).
  const otherInflows =
    y.income.business +
    y.income.deferred +
    y.income.capitalGains +
    y.income.trust +
    y.income.other;
  const rmds = Object.values(y.accountLedgers).reduce(
    (s, l) => s + l.rmdAmount,
    0,
  );
  return {
    year: y.year,
    age: y.ages.client,
    spouseAge: y.ages.spouse ?? (spouseDob ? ageAt(y.year, spouseDob) : null),
    totalPortfolio: y.portfolioAssets.total,
    liquidPortfolio: liquid,
    retirementTotal: y.portfolioAssets.retirementTotal,
    taxableTotal: y.portfolioAssets.taxableTotal,
    cashTotal: y.portfolioAssets.cashTotal,
    realEstateTotal: y.portfolioAssets.realEstateTotal,
    businessTotal: y.portfolioAssets.businessTotal,
    totalIncome: y.totalIncome,
    totalExpenses: y.totalExpenses,
    netCashFlow: y.netCashFlow,
    taxes: y.expenses.taxes,
    withdrawals: y.withdrawals.total,
    rothConversionTaxable: rothTaxable,
    ssIncome: y.income.socialSecurity,
    salaries: y.income.salaries,
    otherInflows,
    rmds,
    living: y.expenses.living,
    insurance: y.expenses.insurance,
  };
}

interface KeyEvents {
  retirementYearClient: number | null;
  retirementYearSpouse: number | null;
  ssClaimYearClient: number | null;
  ssClaimYearSpouse: number | null;
  firstRothConversionYear: number | null;
  lastRothConversionYear: number | null;
  totalRothConverted: number;
  totalRothTaxesPaid: number;
  rmdStartYearClient: number | null;
}

function deriveEvents(
  rows: SummaryRow[],
  dob: Date,
  spouseDob: Date | null | undefined,
  retirementAgeClient: number,
  retirementAgeSpouse: number | null,
): KeyEvents {
  const retClient = dob.getFullYear() + retirementAgeClient;
  const retSpouse = spouseDob && retirementAgeSpouse != null
    ? spouseDob.getFullYear() + retirementAgeSpouse
    : null;

  let firstRoth: number | null = null;
  let lastRoth: number | null = null;
  let totalConverted = 0;
  for (const r of rows) {
    if (r.rothConversionTaxable > 0) {
      if (firstRoth === null) firstRoth = r.year;
      lastRoth = r.year;
      totalConverted += r.rothConversionTaxable;
    }
  }

  // Find first year SS income starts for client (rough — could split by source).
  let firstSsYear: number | null = null;
  for (const r of rows) {
    if (r.ssIncome > 0) {
      firstSsYear = r.year;
      break;
    }
  }

  const rmdStart = dob.getFullYear() + 73; // SECURE 2.0 default

  return {
    retirementYearClient: retClient,
    retirementYearSpouse: retSpouse,
    ssClaimYearClient: firstSsYear,
    ssClaimYearSpouse: null, // single SS stream resolution would need detail
    firstRothConversionYear: firstRoth,
    lastRothConversionYear: lastRoth,
    totalRothConverted: totalConverted,
    totalRothTaxesPaid: 0, // computed below from delta
    rmdStartYearClient: rmdStart,
  };
}

function summarizeScenario(name: string, rows: SummaryRow[]) {
  return {
    name,
    totalTaxesLifetime: sum(rows.map((r) => r.taxes)),
    totalWithdrawalsLifetime: sum(rows.map((r) => r.withdrawals)),
    endingPortfolio: rows.at(-1)?.totalPortfolio ?? 0,
    endingLiquidPortfolio: rows.at(-1)?.liquidPortfolio ?? 0,
    peakPortfolio: Math.max(...rows.map((r) => r.totalPortfolio)),
    peakYear:
      rows.find((r) => r.totalPortfolio === Math.max(...rows.map((x) => x.totalPortfolio)))?.year ?? rows[0]?.year ?? 0,
    yearsModeled: rows.length,
    rows,
  };
}

/**
 * Plan-end legacy totals used by the page-5 Summary-Deltas card and the
 * Estate-Disposition grouped bar chart. Net-to-heirs subtracts taxes,
 * administration, and any charitable bequests from the gross estate.
 */
function legacyTotalsFor(
  result: { secondDeathEvent?: import("../src/engine/types").EstateTaxResult; firstDeathEvent?: import("../src/engine/types").EstateTaxResult },
  totalTaxesLifetime: number,
) {
  const sd = result.secondDeathEvent ?? result.firstDeathEvent;
  const grossEstate = sd?.grossEstate ?? 0;
  const totalEstateTax = sd?.totalEstateTax ?? 0;
  const totalTaxesAndExpenses = sd?.totalTaxesAndExpenses ?? totalEstateTax;
  const totalToCharities = sd?.charitableDeduction ?? 0;
  const totalToHeirs = Math.max(
    0,
    grossEstate - totalTaxesAndExpenses - totalToCharities,
  );
  return {
    totalToHeirs,
    estateTaxLastYear: totalEstateTax,
    totalToCharities,
    totalRetirementIncomeTaxes: totalTaxesLifetime,
  };
}

function deathYearsFor(
  result: { firstDeathEvent?: import("../src/engine/types").EstateTaxResult; secondDeathEvent?: import("../src/engine/types").EstateTaxResult },
) {
  const fd = result.firstDeathEvent;
  const sd = result.secondDeathEvent;
  const deathYearClient =
    sd?.deceased === "client" ? sd.year : fd?.deceased === "client" ? fd.year : null;
  const deathYearSpouse =
    sd?.deceased === "spouse" ? sd.year : fd?.deceased === "spouse" ? fd.year : null;
  return { deathYearClient, deathYearSpouse };
}

// ─── main ─────────────────────────────────────────────────────────────
async function main() {
  console.log(`[memo] loading client ${CLIENT_ID}…`);
  const [client] = await db.select().from(clients).where(eq(clients.id, CLIENT_ID));
  if (!client) throw new Error(`Client ${CLIENT_ID} not found`);

  const contactRows = await db
    .select()
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, client.crmHouseholdId));
  const primary = contactRows.find((c) => c.role === "primary");
  const spouse = contactRows.find((c) => c.role === "spouse");
  if (!primary) throw new Error("No primary contact");

  const dob = primary.dateOfBirth ? new Date(primary.dateOfBirth) : null;
  const spouseDob = spouse?.dateOfBirth ? new Date(spouse.dateOfBirth) : null;

  // Scenarios
  const allScenarios = await db
    .select()
    .from(scenarios)
    .where(eq(scenarios.clientId, CLIENT_ID));
  const baseScenario = allScenarios.find((s) => s.isBaseCase);
  const proposedScenario = allScenarios.find((s) => s.id === PROPOSED_ID);
  if (!baseScenario) throw new Error("No base case scenario");
  if (!proposedScenario) throw new Error(`Proposed scenario ${PROPOSED_ID} not found`);

  console.log(
    `[memo] base="${baseScenario.name}" (${baseScenario.id})  proposed="${proposedScenario.name}" (${proposedScenario.id})`,
  );

  // Account snapshot (for "Current Plan" balance summary; uses base-case scope).
  const baseAccounts = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.clientId, CLIENT_ID), eq(accounts.scenarioId, baseScenario.id)));
  const baseLiabilities = await db
    .select()
    .from(liabilities)
    .where(and(eq(liabilities.clientId, CLIENT_ID), eq(liabilities.scenarioId, baseScenario.id)));
  const baseIncomes = await db
    .select()
    .from(incomes)
    .where(and(eq(incomes.clientId, CLIENT_ID), eq(incomes.scenarioId, baseScenario.id)));
  const baseExpenses = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.clientId, CLIENT_ID), eq(expenses.scenarioId, baseScenario.id)));

  // Scenario-change rows for the proposed scenario (so we can surface
  // human-readable detail on what changed and which accounts/portfolio
  // were touched by the reinvestment overlay).
  const proposedChanges = await db
    .select()
    .from(scenarioChanges)
    .where(eq(scenarioChanges.scenarioId, proposedScenario.id));
  const accountIdsToResolve = new Set<string>();
  const portfolioIdsToResolve = new Set<string>();
  for (const ch of proposedChanges) {
    if (ch.targetKind === "reinvestment") {
      const p = ch.payload as Record<string, unknown> | null;
      const ids = (p?.accountIds as string[] | undefined) ?? [];
      for (const id of ids) accountIdsToResolve.add(id);
      const portfolioId = p?.modelPortfolioId as string | undefined;
      if (portfolioId) portfolioIdsToResolve.add(portfolioId);
    }
    if (ch.targetKind === "account") accountIdsToResolve.add(ch.targetId);
    if (ch.targetKind === "expense") accountIdsToResolve.add(ch.targetId);
  }
  const resolvedAccounts = accountIdsToResolve.size
    ? await db.select().from(accounts).where(inArray(accounts.id, [...accountIdsToResolve]))
    : [];
  const resolvedPortfolios = portfolioIdsToResolve.size
    ? await db
        .select()
        .from(modelPortfolios)
        .where(inArray(modelPortfolios.id, [...portfolioIdsToResolve]))
    : [];
  const expensesMap = new Map(baseExpenses.map((e) => [e.id, e]));
  const accountsMap = new Map(resolvedAccounts.map((a) => [a.id, a]));
  const portfoliosMap = new Map(resolvedPortfolios.map((p) => [p.id, p]));

  // Project both scenarios.
  console.log("[memo] loading + projecting base case…");
  const baseTree = (
    await loadEffectiveTree(CLIENT_ID, client.firmId, baseScenario.id, {})
  ).effectiveTree;
  const baseResult = runProjectionWithEvents(baseTree);

  console.log("[memo] loading + projecting proposed scenario…");
  const proposedTree = (
    await loadEffectiveTree(CLIENT_ID, client.firmId, proposedScenario.id, {})
  ).effectiveTree;
  const proposedResult = runProjectionWithEvents(proposedTree);

  // Monte Carlo (1000 trials each — same engine as the in-app overview).
  console.log("[memo] running Monte Carlo for base case (1000 trials)…");
  const mcBase = await getMonteCarloResult(CLIENT_ID, client.firmId, baseScenario.id, {});
  console.log("[memo] running Monte Carlo for proposed scenario (1000 trials)…");
  const mcProposed = await getMonteCarloResult(CLIENT_ID, client.firmId, proposedScenario.id, {});

  // Summarize.
  const baseRows = baseResult.years.map((y) => summarizeYear(y, dob, spouseDob));
  const proposedRows = proposedResult.years.map((y) => summarizeYear(y, dob, spouseDob));

  // Asset allocation snapshot (current balance breakdown) for the pie charts.
  const allocCurrent = {
    taxable: baseTree.accounts.filter((a) => a.category === "taxable").reduce((s, a) => s + a.value, 0),
    retirement: baseTree.accounts.filter((a) => a.category === "retirement").reduce((s, a) => s + a.value, 0),
    cash: baseTree.accounts.filter((a) => a.category === "cash").reduce((s, a) => s + a.value, 0),
    realEstate: baseTree.accounts.filter((a) => a.category === "real_estate").reduce((s, a) => s + a.value, 0),
    business: baseTree.accounts.filter((a) => a.category === "business").reduce((s, a) => s + a.value, 0),
    lifeInsurance: baseTree.accounts.filter((a) => a.category === "life_insurance").reduce((s, a) => s + a.value, 0),
  };

  const allocProposed = {
    taxable: proposedTree.accounts.filter((a) => a.category === "taxable").reduce((s, a) => s + a.value, 0),
    retirement: proposedTree.accounts.filter((a) => a.category === "retirement").reduce((s, a) => s + a.value, 0),
    cash: proposedTree.accounts.filter((a) => a.category === "cash").reduce((s, a) => s + a.value, 0),
    realEstate: proposedTree.accounts.filter((a) => a.category === "real_estate").reduce((s, a) => s + a.value, 0),
    business: proposedTree.accounts.filter((a) => a.category === "business").reduce((s, a) => s + a.value, 0),
    lifeInsurance: proposedTree.accounts.filter((a) => a.category === "life_insurance").reduce((s, a) => s + a.value, 0),
  };

  // Key events.
  const baseEvents = deriveEvents(
    baseRows,
    dob!,
    spouseDob,
    baseTree.client.retirementAge,
    (baseTree.client as any).spouseRetirementAge ?? null,
  );
  const proposedEvents = deriveEvents(
    proposedRows,
    dob!,
    spouseDob,
    proposedTree.client.retirementAge,
    (proposedTree.client as any).spouseRetirementAge ?? null,
  );

  // Longevity by year (per Monte Carlo trial — success defined as liquid > 0
  // at each year). This is a coarse longevity-confidence-by-year curve:
  // (# trials with liquid assets > 0 at year Y) / total trials.
  function longevityCurve(mc: { byYearLiquidAssetsPerTrial: number[][]; trialsRun: number }, years: number[]) {
    if (mc.trialsRun === 0) return [] as { year: number; age: number; successPct: number }[];
    const nYears = mc.byYearLiquidAssetsPerTrial[0]?.length ?? 0;
    const out: { year: number; age: number; successPct: number }[] = [];
    for (let i = 0; i < nYears; i++) {
      let alive = 0;
      for (const trial of mc.byYearLiquidAssetsPerTrial) {
        if ((trial[i] ?? 0) > 0) alive++;
      }
      const year = years[i] ?? (years[0] ?? 0) + i;
      const age = dob ? year - dob.getFullYear() : 0;
      out.push({ year, age, successPct: Math.round((alive / mc.trialsRun) * 100) });
    }
    return out;
  }

  // Per-year liquid-asset quantiles across all trials (p10 / p50 / p90).
  // This powers the real range-of-outcomes chart on the analysis page.
  function perYearQuantiles(
    mc: { byYearLiquidAssetsPerTrial: number[][]; trialsRun: number },
    years: number[],
  ) {
    if (mc.trialsRun === 0) {
      return [] as { year: number; p10: number; p50: number; p90: number }[];
    }
    const nYears = mc.byYearLiquidAssetsPerTrial[0]?.length ?? 0;
    const out: { year: number; p10: number; p50: number; p90: number }[] = [];
    for (let i = 0; i < nYears; i++) {
      const slice = mc.byYearLiquidAssetsPerTrial.map((t) => t[i] ?? 0).sort((a, b) => a - b);
      const pick = (p: number) => slice[Math.floor(slice.length * p)] ?? 0;
      const year = years[i] ?? (years[0] ?? 0) + i;
      out.push({
        year,
        p10: pick(0.1),
        p50: pick(0.5),
        p90: pick(0.9),
      });
    }
    return out;
  }

  const planYears = baseRows.map((r) => r.year);

  // ─── account inventory (for "current plan" narrative & visuals) ──────
  const accountInventory = baseAccounts.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
    value: parseFloat(a.value),
  }));
  const liabilityInventory = baseLiabilities.map((l) => ({
    id: l.id,
    name: l.name,
    balance: parseFloat(l.balance),
  }));
  const incomeInventory = baseIncomes.map((i) => ({
    id: i.id,
    type: i.type,
    name: i.name,
    annualAmount: parseFloat(i.annualAmount),
    startYear: i.startYear,
    endYear: i.endYear,
    owner: i.owner,
  }));
  const expenseInventory = baseExpenses.map((e) => ({
    id: e.id,
    type: e.type,
    name: e.name,
    annualAmount: parseFloat(e.annualAmount),
    startYear: e.startYear,
    endYear: e.endYear,
    startYearRef: e.startYearRef,
    endYearRef: e.endYearRef,
    growthRate: parseFloat(e.growthRate ?? "0"),
  }));

  // Resolve each scenario_change row into a structured, human-readable record
  // so the PDF can describe what changed without re-querying the database.
  type ResolvedChange =
    | {
        kind: "client_edit";
        field: string;
        from: unknown;
        to: unknown;
      }
    | {
        kind: "expense_edit";
        expenseName: string | null;
        expenseType: string | null;
        field: string;
        from: unknown;
        to: unknown;
      }
    | {
        kind: "reinvestment";
        name: string;
        year: number;
        portfolioName: string | null;
        portfolioDescription: string | null;
        accountNames: string[];
        realizeTaxesOnSwitch: boolean;
      }
    | {
        kind: "other";
        op: string;
        targetKind: string;
        targetId: string;
        payload: unknown;
      };

  const resolvedChanges: ResolvedChange[] = [];
  for (const ch of proposedChanges) {
    if (!ch.enabled) continue;
    const payload = ch.payload as Record<string, unknown> | null;
    if (ch.targetKind === "client" && ch.opType === "edit" && payload) {
      for (const [field, deltaRaw] of Object.entries(payload)) {
        const delta = deltaRaw as { from?: unknown; to?: unknown };
        resolvedChanges.push({
          kind: "client_edit",
          field,
          from: delta.from,
          to: delta.to,
        });
      }
    } else if (ch.targetKind === "expense" && ch.opType === "edit" && payload) {
      const exp = expensesMap.get(ch.targetId);
      for (const [field, deltaRaw] of Object.entries(payload)) {
        const delta = deltaRaw as { from?: unknown; to?: unknown };
        resolvedChanges.push({
          kind: "expense_edit",
          expenseName: exp?.name ?? null,
          expenseType: exp?.type ?? null,
          field,
          from: delta.from,
          to: delta.to,
        });
      }
    } else if (ch.targetKind === "reinvestment" && payload) {
      const portfolioId = payload.modelPortfolioId as string | undefined;
      const portfolio = portfolioId ? portfoliosMap.get(portfolioId) : undefined;
      const accountIds = (payload.accountIds as string[] | undefined) ?? [];
      resolvedChanges.push({
        kind: "reinvestment",
        name: (payload.name as string) ?? "Reinvestment",
        year: (payload.year as number) ?? 0,
        portfolioName: portfolio?.name ?? null,
        portfolioDescription: portfolio?.description ?? null,
        accountNames: accountIds
          .map((id) => accountsMap.get(id)?.name ?? null)
          .filter((n): n is string => Boolean(n)),
        realizeTaxesOnSwitch: Boolean(payload.realizeTaxesOnSwitch),
      });
    } else {
      resolvedChanges.push({
        kind: "other",
        op: ch.opType,
        targetKind: ch.targetKind,
        targetId: ch.targetId,
        payload,
      });
    }
  }

  // ─── shape final payload ─────────────────────────────────────────────
  const payload = {
    document: {
      title: "Retirement Plan Memo",
      subtitle: "Current vs. Proposed",
      advisor: "Ethos Financial Group",
      preparedOn: new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      clientNames: [
        `${primary.firstName} ${primary.lastName}`,
        spouse ? `${spouse.firstName} ${spouse.lastName}` : null,
      ].filter(Boolean) as string[],
    },
    household: {
      clientFirstName: primary.firstName,
      clientLastName: primary.lastName,
      spouseFirstName: spouse?.firstName ?? null,
      clientDob: primary.dateOfBirth ?? null,
      spouseDob: spouse?.dateOfBirth ?? null,
      planStartYear: baseTree.planSettings.planStartYear,
      planEndYear: baseTree.planSettings.planEndYear,
      filingStatus: baseTree.client.filingStatus,
      currentAge: dob ? new Date().getFullYear() - dob.getFullYear() : null,
      spouseCurrentAge: spouseDob ? new Date().getFullYear() - spouseDob.getFullYear() : null,
      inflationRate: baseTree.planSettings.inflationRate,
    },
    base: {
      ...summarizeScenario(baseScenario.name, baseRows),
      ...legacyTotalsFor(baseResult, sum(baseRows.map((r) => r.taxes))),
      ...deathYearsFor(baseResult),
      retirementAge: baseTree.client.retirementAge,
      spouseRetirementAge: (baseTree.client as any).spouseRetirementAge ?? null,
      planEndAge: baseTree.client.planEndAge,
      lifeExpectancy: baseTree.client.lifeExpectancy,
      events: baseEvents,
      allocation: allocCurrent,
      mc: mcBase
        ? {
            successRate: mcBase.successRate,
            successPct: Math.round(mcBase.successRate * 100),
            trialsRun: mcBase.trialsRun,
            medianEndingLiquid:
              [...mcBase.endingLiquidAssets].sort((a, b) => a - b)[Math.floor(mcBase.endingLiquidAssets.length / 2)] ??
              0,
            p10EndingLiquid:
              [...mcBase.endingLiquidAssets].sort((a, b) => a - b)[Math.floor(mcBase.endingLiquidAssets.length * 0.1)] ??
              0,
            p90EndingLiquid:
              [...mcBase.endingLiquidAssets].sort((a, b) => a - b)[Math.floor(mcBase.endingLiquidAssets.length * 0.9)] ??
              0,
            longevity: longevityCurve(mcBase, planYears),
            byYearQuantiles: perYearQuantiles(mcBase, planYears),
          }
        : null,
    },
    proposed: {
      ...summarizeScenario(proposedScenario.name, proposedRows),
      ...legacyTotalsFor(proposedResult, sum(proposedRows.map((r) => r.taxes))),
      ...deathYearsFor(proposedResult),
      retirementAge: proposedTree.client.retirementAge,
      spouseRetirementAge: (proposedTree.client as any).spouseRetirementAge ?? null,
      planEndAge: proposedTree.client.planEndAge,
      lifeExpectancy: proposedTree.client.lifeExpectancy,
      events: proposedEvents,
      allocation: allocProposed,
      mc: mcProposed
        ? {
            successRate: mcProposed.successRate,
            successPct: Math.round(mcProposed.successRate * 100),
            trialsRun: mcProposed.trialsRun,
            medianEndingLiquid:
              [...mcProposed.endingLiquidAssets].sort((a, b) => a - b)[
                Math.floor(mcProposed.endingLiquidAssets.length / 2)
              ] ?? 0,
            p10EndingLiquid:
              [...mcProposed.endingLiquidAssets].sort((a, b) => a - b)[
                Math.floor(mcProposed.endingLiquidAssets.length * 0.1)
              ] ?? 0,
            p90EndingLiquid:
              [...mcProposed.endingLiquidAssets].sort((a, b) => a - b)[
                Math.floor(mcProposed.endingLiquidAssets.length * 0.9)
              ] ?? 0,
            longevity: longevityCurve(mcProposed, planYears),
            byYearQuantiles: perYearQuantiles(mcProposed, planYears),
          }
        : null,
    },
    inventory: {
      accounts: accountInventory,
      liabilities: liabilityInventory,
      incomes: incomeInventory,
      expenses: expenseInventory,
    },
    scenarioChanges: resolvedChanges,
    estate: {
      base: {
        firstDeath: baseResult.firstDeathEvent
          ? {
              year: baseResult.firstDeathEvent.year,
              grossEstate: baseResult.firstDeathEvent.grossEstate,
              taxableEstate: baseResult.firstDeathEvent.taxableEstate,
              federalEstateTax: baseResult.firstDeathEvent.federalEstateTax,
              stateEstateTax: baseResult.firstDeathEvent.stateEstateTax,
              totalEstateTax: baseResult.firstDeathEvent.totalEstateTax,
              totalTaxesAndExpenses: baseResult.firstDeathEvent.totalTaxesAndExpenses,
            }
          : null,
        secondDeath: baseResult.secondDeathEvent
          ? {
              year: baseResult.secondDeathEvent.year,
              grossEstate: baseResult.secondDeathEvent.grossEstate,
              taxableEstate: baseResult.secondDeathEvent.taxableEstate,
              federalEstateTax: baseResult.secondDeathEvent.federalEstateTax,
              stateEstateTax: baseResult.secondDeathEvent.stateEstateTax,
              totalEstateTax: baseResult.secondDeathEvent.totalEstateTax,
              totalTaxesAndExpenses: baseResult.secondDeathEvent.totalTaxesAndExpenses,
            }
          : null,
      },
      proposed: {
        firstDeath: proposedResult.firstDeathEvent
          ? {
              year: proposedResult.firstDeathEvent.year,
              grossEstate: proposedResult.firstDeathEvent.grossEstate,
              taxableEstate: proposedResult.firstDeathEvent.taxableEstate,
              federalEstateTax: proposedResult.firstDeathEvent.federalEstateTax,
              stateEstateTax: proposedResult.firstDeathEvent.stateEstateTax,
              totalEstateTax: proposedResult.firstDeathEvent.totalEstateTax,
              totalTaxesAndExpenses: proposedResult.firstDeathEvent.totalTaxesAndExpenses,
            }
          : null,
        secondDeath: proposedResult.secondDeathEvent
          ? {
              year: proposedResult.secondDeathEvent.year,
              grossEstate: proposedResult.secondDeathEvent.grossEstate,
              taxableEstate: proposedResult.secondDeathEvent.taxableEstate,
              federalEstateTax: proposedResult.secondDeathEvent.federalEstateTax,
              stateEstateTax: proposedResult.secondDeathEvent.stateEstateTax,
              totalEstateTax: proposedResult.secondDeathEvent.totalEstateTax,
              totalTaxesAndExpenses: proposedResult.secondDeathEvent.totalTaxesAndExpenses,
            }
          : null,
      },
    },
  };

  const outAbs = resolvePath(process.cwd(), OUT_PATH);
  writeFileSync(outAbs, JSON.stringify(payload, null, 2));
  console.log(`[memo] wrote ${outAbs}`);
  console.log(
    `[memo] base success: ${payload.base.mc?.successPct ?? "n/a"}%  proposed success: ${payload.proposed.mc?.successPct ?? "n/a"}%`,
  );
  console.log(
    `[memo] base ending: $${Math.round((payload.base.endingPortfolio ?? 0) / 1e6 * 10) / 10}M  proposed ending: $${Math.round((payload.proposed.endingPortfolio ?? 0) / 1e6 * 10) / 10}M`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[memo] FAILED:", err);
  process.exit(1);
});
