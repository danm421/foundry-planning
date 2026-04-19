/**
 * End-to-end Monte Carlo verification against live DB data.
 * Usage: npx tsx scripts/verify-mc.ts [clientFirstName]
 *
 * Loads a client's plan from Postgres, mirrors the projection-data and
 * monte-carlo-data API routes' assembly logic, runs 1000 MC trials, and
 * compares against the deterministic cash flow projection. Prints a
 * sanity-check report with anomaly detection.
 */

import { neon } from "@neondatabase/serverless";
import {
  runMonteCarlo,
  summarizeMonteCarlo,
  createReturnEngine,
  buildCorrelationMatrix,
  type AccountAssetMix,
  type IndexInput,
  type ClientData,
  type Account,
} from "../src/engine";
import { runProjection } from "../src/engine/projection";

const sql = neon(process.env.DATABASE_URL!);

async function main() {

const targetName = process.argv[2] ?? "Dan";
const allClients = await sql`SELECT id, first_name, last_name, firm_id FROM clients ORDER BY first_name`;
const client = allClients.find((c: any) => c.first_name === targetName) ?? allClients[0];
if (!client) { console.log("no clients"); process.exit(1); }
console.log(`\n══ VERIFYING: ${client.first_name} ${client.last_name} (${client.id}) ══`);

const [clientFull] = await sql`SELECT * FROM clients WHERE id = ${client.id}`;
const [scenario] = await sql`SELECT * FROM scenarios WHERE client_id = ${client.id} AND is_base_case = true`;
const [settings] = await sql`SELECT * FROM plan_settings WHERE scenario_id = ${scenario.id} LIMIT 1`;
const accountRows = await sql`SELECT * FROM accounts WHERE scenario_id = ${scenario.id}`;
const incomeRows = await sql`SELECT * FROM incomes WHERE scenario_id = ${scenario.id}`;
const expenseRows = await sql`SELECT * FROM expenses WHERE scenario_id = ${scenario.id}`;
const liabilityRows = await sql`SELECT * FROM liabilities WHERE scenario_id = ${scenario.id}`;
const savingsRows = await sql`SELECT * FROM savings_rules WHERE scenario_id = ${scenario.id}`;
const withdrawalRows = await sql`SELECT * FROM withdrawal_strategies WHERE scenario_id = ${scenario.id}`;
const acctAllocs = await sql`SELECT * FROM account_asset_allocations`;
const portAllocs = await sql`SELECT * FROM model_portfolio_allocations`;
const assetClassRows = await sql`SELECT * FROM asset_classes WHERE firm_id = ${client.firm_id}`;
const corrRows = await sql`
  SELECT acc.* FROM asset_class_correlations acc
  INNER JOIN asset_classes ac ON acc.asset_class_id_a = ac.id
  WHERE ac.firm_id = ${client.firm_id}`;
const entityRows = await sql`SELECT * FROM entities WHERE client_id = ${client.id}`;

console.log(`Plan: ${settings.plan_start_year}–${settings.plan_end_year} (${settings.plan_end_year - settings.plan_start_year + 1} years)`);
console.log(`Accounts: ${accountRows.length} total, ${accountRows.filter((a: any) => ['taxable','cash','retirement'].includes(a.category)).length} investable`);

// ── Resolve each account's deterministic growth rate (mirrors projection-data) ──
const allocsByAcct = new Map<string, any[]>();
for (const a of acctAllocs) {
  const list = allocsByAcct.get(a.account_id) ?? [];
  list.push(a);
  allocsByAcct.set(a.account_id, list);
}
const allocsByPort = new Map<string, any[]>();
for (const a of portAllocs) {
  const list = allocsByPort.get(a.model_portfolio_id) ?? [];
  list.push(a);
  allocsByPort.set(a.model_portfolio_id, list);
}
const acById = new Map(assetClassRows.map((ac: any) => [ac.id, ac]));
const resolvePortfolio = (portId: string) => {
  const allocs = allocsByPort.get(portId) ?? [];
  let gm = 0;
  for (const a of allocs) {
    const ac = acById.get(a.asset_class_id);
    if (ac) gm += parseFloat(a.weight) * parseFloat(ac.geometric_return);
  }
  return gm;
};
const resolveAccountMix = (accountId: string) => {
  const allocs = allocsByAcct.get(accountId) ?? [];
  let gm = 0;
  for (const a of allocs) {
    const ac = acById.get(a.asset_class_id);
    if (ac) gm += parseFloat(a.weight) * parseFloat(ac.geometric_return);
  }
  return gm;
};
const categoryDefault = (cat: string) => {
  if (cat === "taxable") return { source: settings.growth_source_taxable, portId: settings.model_portfolio_id_taxable, custom: settings.default_growth_taxable };
  if (cat === "cash") return { source: settings.growth_source_cash, portId: settings.model_portfolio_id_cash, custom: settings.default_growth_cash };
  if (cat === "retirement") return { source: settings.growth_source_retirement, portId: settings.model_portfolio_id_retirement, custom: settings.default_growth_retirement };
  return { source: "custom", portId: null, custom: "0" };
};

const accounts: Account[] = accountRows.map((a: any) => {
  let growthRate: number;
  let effSource = a.growth_source ?? "default";
  if (effSource === "default") {
    if (a.category === "real_estate") growthRate = parseFloat(a.growth_rate ?? settings.default_growth_real_estate);
    else if (a.category === "business") growthRate = parseFloat(a.growth_rate ?? settings.default_growth_business);
    else if (a.category === "life_insurance") growthRate = parseFloat(a.growth_rate ?? settings.default_growth_life_insurance);
    else {
      const def = categoryDefault(a.category);
      if (def.source === "model_portfolio" && def.portId) growthRate = resolvePortfolio(def.portId);
      else if (def.source === "asset_mix") growthRate = resolveAccountMix(a.id);
      else growthRate = parseFloat(def.custom);
    }
  } else if (effSource === "model_portfolio" && a.model_portfolio_id) {
    growthRate = resolvePortfolio(a.model_portfolio_id);
  } else if (effSource === "asset_mix") {
    growthRate = resolveAccountMix(a.id);
  } else if (effSource === "custom") {
    growthRate = parseFloat(a.growth_rate ?? "0");
  } else {
    growthRate = parseFloat(a.growth_rate ?? "0");
  }

  return {
    id: a.id,
    name: a.name,
    category: a.category as Account["category"],
    subType: a.sub_type,
    owner: a.owner as "client" | "spouse" | "joint",
    value: parseFloat(a.value),
    basis: parseFloat(a.basis),
    growthRate,
    rmdEnabled: a.rmd_enabled,
    isDefaultChecking: a.is_default_checking,
    ownerEntityId: a.owner_entity_id ?? undefined,
    annualPropertyTax: parseFloat(a.annual_property_tax ?? "0"),
    propertyTaxGrowthRate: parseFloat(a.property_tax_growth_rate ?? "0.03"),
  };
});

// Build the minimum ClientData the engine needs. Skipping tax bracket data for
// simplicity — engine falls back to flat mode.
const clientData: ClientData = {
  client: {
    firstName: client.first_name, lastName: client.last_name,
    dateOfBirth: (() => {
      const raw = clientFull.date_of_birth;
      if (raw instanceof Date) return raw.toISOString().slice(0, 10);
      return String(raw);
    })(),
    retirementAge: clientFull.retirement_age ?? 65,
    planEndAge: clientFull.plan_end_age ?? 95,
    filingStatus: (clientFull.filing_status ?? "single") as ClientData["client"]["filingStatus"],
    spouseDob: clientFull.spouse_dob
      ? (clientFull.spouse_dob instanceof Date
          ? clientFull.spouse_dob.toISOString().slice(0, 10)
          : String(clientFull.spouse_dob))
      : undefined,
  },
  accounts,
  incomes: incomeRows.map((i: any) => ({
    id: i.id, type: i.type, name: i.name, annualAmount: parseFloat(i.annual_amount),
    startYear: i.start_year, endYear: i.end_year, growthRate: parseFloat(i.growth_rate ?? "0.03"),
    owner: i.owner, claimingAge: i.claiming_age ?? undefined,
  })),
  expenses: expenseRows.map((e: any) => ({
    id: e.id, type: e.type, name: e.name, annualAmount: parseFloat(e.annual_amount),
    startYear: e.start_year, endYear: e.end_year, growthRate: parseFloat(e.growth_rate ?? "0.03"),
  })),
  liabilities: liabilityRows.map((l: any) => ({
    id: l.id, name: l.name, balance: parseFloat(l.balance), interestRate: parseFloat(l.interest_rate),
    monthlyPayment: parseFloat(l.monthly_payment), startYear: l.start_year, startMonth: l.start_month ?? 1,
    termMonths: l.term_months, extraPayments: [],
  })),
  savingsRules: savingsRows.map((s: any) => ({
    id: s.id, accountId: s.account_id, annualAmount: parseFloat(s.annual_amount),
    isDeductible: s.is_deductible ?? true,
    startYear: s.start_year, endYear: s.end_year,
  })),
  withdrawalStrategy: withdrawalRows.map((w: any) => ({
    accountId: w.account_id, priorityOrder: w.priority_order,
    startYear: w.start_year, endYear: w.end_year,
  })),
  planSettings: {
    flatFederalRate: parseFloat(settings.flat_federal_rate),
    flatStateRate: parseFloat(settings.flat_state_rate),
    inflationRate: parseFloat(settings.inflation_rate),
    planStartYear: settings.plan_start_year,
    planEndYear: settings.plan_end_year,
    taxEngineMode: "flat",
  },
  entities: entityRows.map((e: any) => ({ id: e.id, includeInPortfolio: e.include_in_portfolio, isGrantor: e.is_grantor ?? false })),
};

// ── Build account mixes ────────────────────────────────────────────────
const accountMixes = new Map<string, AccountAssetMix[]>();
for (const acct of accountRows) {
  if (!['taxable','cash','retirement'].includes(acct.category)) continue;
  let effSource = acct.growth_source ?? "default";
  let effPortId = acct.model_portfolio_id;
  if (effSource === "default") {
    const def = categoryDefault(acct.category);
    effSource = def.source;
    if (effSource === "model_portfolio") effPortId = def.portId;
  }
  let mix: AccountAssetMix[] = [];
  if (effSource === "asset_mix") {
    mix = (allocsByAcct.get(acct.id) ?? []).map((a: any) => ({ assetClassId: a.asset_class_id, weight: parseFloat(a.weight) }));
  } else if (effSource === "model_portfolio" && effPortId) {
    mix = (allocsByPort.get(effPortId) ?? []).map((a: any) => ({ assetClassId: a.asset_class_id, weight: parseFloat(a.weight) }));
  }
  if (mix.length > 0) accountMixes.set(acct.id, mix);
}
console.log(`Randomized accounts: ${accountMixes.size}`);

const usedIds = new Set<string>();
for (const mix of accountMixes.values()) for (const m of mix) if (m.weight !== 0) usedIds.add(m.assetClassId);
const indices: IndexInput[] = assetClassRows.filter((ac: any) => usedIds.has(ac.id)).map((ac: any) => ({
  id: ac.id, arithMean: parseFloat(ac.arithmetic_mean), stdDev: parseFloat(ac.volatility),
}));
const correlation = buildCorrelationMatrix(indices.map(i => i.id), corrRows.map((r: any) => ({
  assetClassIdA: r.asset_class_id_a, assetClassIdB: r.asset_class_id_b, correlation: r.correlation,
})));
console.log(`Indices participating: ${indices.length}`);

const seed = scenario.monte_carlo_seed ?? 1;
const engine = createReturnEngine({ indices, correlation, seed });
const result = await runMonteCarlo({
  data: clientData, returnEngine: engine, accountMixes, trials: 1000, requiredMinimumAssetLevel: 0,
});

const startingLiquid = accounts
  .filter(a => ['taxable','cash','retirement'].includes(a.category))
  .reduce((s, a) => s + a.value, 0);
const summary = summarizeMonteCarlo(result, {
  client: clientData.client, planSettings: clientData.planSettings, startingLiquidBalance: startingLiquid,
});

// Deterministic baseline
const determ = runProjection(clientData);
const determEnding = (() => {
  const last = determ[determ.length - 1];
  return last.portfolioAssets.taxableTotal + last.portfolioAssets.cashTotal + last.portfolioAssets.retirementTotal;
})();

// ── REPORT ─────────────────────────────────────────────────────────────
const fmt$ = (v: number) => Number.isFinite(v) ? `$${(v/1e6).toFixed(2)}M` : "—";

console.log(`\n── Run config ──`);
console.log(`Seed: ${seed}  Trials: ${summary.trialsRun}  Years: ${summary.byYear.length}  Starting liquid: ${fmt$(startingLiquid)}`);

console.log(`\n── Top-line ──`);
console.log(`Success rate: ${(summary.successRate * 100).toFixed(1)}%   Failure rate: ${(summary.failureRate * 100).toFixed(1)}%`);

console.log(`\n── Terminal distribution (ending liquid assets) ──`);
console.log(`p5:  ${fmt$(summary.ending.p5).padStart(8)}`);
console.log(`p20: ${fmt$(summary.ending.p20).padStart(8)}`);
console.log(`p50: ${fmt$(summary.ending.p50).padStart(8)}   ← median MC`);
console.log(`p80: ${fmt$(summary.ending.p80).padStart(8)}`);
console.log(`p95: ${fmt$(summary.ending.p95).padStart(8)}`);
console.log(`min: ${fmt$(summary.ending.min).padStart(8)}`);
console.log(`max: ${fmt$(summary.ending.max).padStart(8)}`);
console.log(`mean:${fmt$(summary.ending.mean).padStart(8)}`);
console.log(`Deterministic cash flow ending: ${fmt$(determEnding)}`);

const gapPct = (summary.ending.p50 - determEnding) / Math.max(1, determEnding);
console.log(`\n── Gap vs deterministic ──`);
console.log(`Median MC − deterministic: ${(gapPct * 100).toFixed(1)}%`);
if (Math.abs(gapPct) > 0.5) console.log(`  ⚠ gap > 50% — investigate correlations / arith-geo consistency`);
else if (Math.abs(gapPct) < 0.05) console.log(`  ℹ gap < 5% — plan has minimal diversification randomization`);
else console.log(`  ✓ gap within 5-50% — looks like legitimate diversification-capture math`);

console.log(`\n── Per-year sanity (sampled) ──`);
console.log("Year  Age    Determ    p20       p50       p80       p80/p20");
const step = Math.max(1, Math.floor(summary.byYear.length / 8));
for (let i = 0; i < summary.byYear.length; i += step) {
  const r = summary.byYear[i];
  const determRow = determ[i];
  const determLiq = determRow.portfolioAssets.taxableTotal + determRow.portfolioAssets.cashTotal + determRow.portfolioAssets.retirementTotal;
  const spread = r.balance.p20 > 0 ? (r.balance.p80 / r.balance.p20).toFixed(2) + "x" : "—";
  const ageStr = r.age.spouse != null ? `${r.age.client}/${r.age.spouse}` : `${r.age.client}`;
  console.log(`${r.year}  ${ageStr.padEnd(5)}  ${fmt$(determLiq).padStart(7)}  ${fmt$(r.balance.p20).padStart(7)}  ${fmt$(r.balance.p50).padStart(7)}  ${fmt$(r.balance.p80).padStart(7)}  ${spread}`);
}

console.log(`\n── Anomaly checks ──`);
let issues = 0;
for (const r of summary.byYear) {
  if (!(r.balance.p20 <= r.balance.p50 + 1e-6 && r.balance.p50 <= r.balance.p80 + 1e-6)) {
    console.log(`⚠ Year ${r.year}: percentile ordering broken`); issues++;
  }
  for (const k of ['p5','p20','p50','p80','p95','min','max'] as const) {
    if (!Number.isFinite(r.balance[k])) { console.log(`⚠ Year ${r.year}: balance.${k} non-finite`); issues++; }
  }
}
if (issues === 0) console.log(`✓ All per-year percentiles monotonic and finite`);

const earlySpread = summary.byYear[0].balance.p80 / Math.max(1, summary.byYear[0].balance.p20);
const lateSpread = summary.byYear[summary.byYear.length-1].balance.p80 / Math.max(1, summary.byYear[summary.byYear.length-1].balance.p20);
if (lateSpread > earlySpread) console.log(`✓ Uncertainty widens with horizon (${earlySpread.toFixed(2)}x → ${lateSpread.toFixed(2)}x)`);
else { console.log(`⚠ Uncertainty didn't widen (${earlySpread.toFixed(2)}x → ${lateSpread.toFixed(2)}x)`); issues++; }

// Determinism check
const engine2 = createReturnEngine({ indices, correlation, seed });
const result2 = await runMonteCarlo({ data: clientData, returnEngine: engine2, accountMixes, trials: 1000, requiredMinimumAssetLevel: 0 });
const sum2 = summarizeMonteCarlo(result2, { client: clientData.client, planSettings: clientData.planSettings, startingLiquidBalance: startingLiquid });
if (sum2.ending.p50 === summary.ending.p50) console.log(`✓ Deterministic: same seed reproduces byte-identical ending p50`);
else { console.log(`⚠ Non-deterministic: same seed gave ${sum2.ending.p50} vs ${summary.ending.p50}`); issues++; }

console.log(`\n── ${issues === 0 ? '✓ NO ISSUES FOUND — output looks correct' : `⚠ ${issues} ISSUE(S)`} ──\n`);

}
main().catch(err => { console.error(err); process.exit(1); });
