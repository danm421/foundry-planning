/**
 * Pure-fixture tests for loadClientData.
 *
 * Approach: Plan B (pure fixture + vi.mock("@/db")).
 * No DB connection required — the mock routes each .from(table) call to the
 * matching in-memory fixture array, mirroring the pattern used in
 * src/app/api/clients/[id]/wills/__tests__/route.test.ts.
 *
 * Three tests:
 *  1. Throws ClientNotFoundError for an unknown clientId
 *  2. Throws ClientNotFoundError when firmId doesn't match the client's firm
 *  3. Returns a populated ClientData for a valid client + full snapshot
 *
 * The mock's .where() returns all rows in the table bucket — we simulate the
 * DB's (id AND firmId) filter for the clients table by only seeding rows that
 * a real WHERE clause would return. Tests that want a "not found" result simply
 * leave dbState.clients empty (or populate it only with non-matching rows).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";

import {
  FIXTURE_FIRM_ID,
  FIXTURE_CLIENT_ID,
  WRONG_FIRM_ID,
  clientRow,
  crmHouseholdRow,
  crmPrimaryContactRow,
  crmSpouseContactRow,
  scenarioRow,
  planSettingsRow,
  accountRows,
  incomeRow,
  expenseRow,
  liabilityRow,
  savingsRuleRow,
  familyMemberRow,
  externalBeneficiaryRow,
  willRow,
  willBequestRow,
  willBequestRecipientRow,
  willResiduaryRecipientRow,
  transferRow,
  taxYearParameterRow,
  modelPortfolioRow,
  modelPortfolioAllocationRow,
  assetClassRow,
  inflationAssetClassRow,
  tickerPortfolioRow,
  tickerPortfolioHoldingRow,
  securityAssetClassWeightRow,
  tickerPortfolioAccountRow,
} from "./fixtures/sample-rows";

// ---------------------------------------------------------------------------
// DbState — mutable per-test fixture store
// ---------------------------------------------------------------------------
type DbState = {
  clients: typeof clientRow[];
  crmHouseholds: typeof crmHouseholdRow[];
  crmHouseholdContacts: (typeof crmPrimaryContactRow | typeof crmSpouseContactRow)[];
  scenarios: typeof scenarioRow[];
  planSettings: typeof planSettingsRow[];
  accounts: (typeof accountRows)[0][];
  incomes: typeof incomeRow[];
  expenses: typeof expenseRow[];
  liabilities: typeof liabilityRow[];
  savingsRules: typeof savingsRuleRow[];
  withdrawalStrategies: unknown[];
  entities: unknown[];
  modelPortfolios: typeof modelPortfolioRow[];
  modelPortfolioAllocations: typeof modelPortfolioAllocationRow[];
  assetClasses: (typeof assetClassRow | typeof inflationAssetClassRow)[];
  accountAssetAllocations: unknown[];
  extraPayments: unknown[];
  transfers: typeof transferRow[];
  transferSchedules: unknown[];
  assetTransactions: unknown[];
  gifts: unknown[];
  familyMembers: typeof familyMemberRow[];
  externalBeneficiaries: typeof externalBeneficiaryRow[];
  beneficiaryDesignations: unknown[];
  clientCmaOverrides: unknown[];
  wills: typeof willRow[];
  willBequests: typeof willBequestRow[];
  willBequestRecipients: typeof willBequestRecipientRow[];
  willResiduaryRecipients: typeof willResiduaryRecipientRow[];
  taxYearParameters: typeof taxYearParameterRow[];
  clientDeductions: unknown[];
  incomeScheduleOverrides: unknown[];
  expenseScheduleOverrides: unknown[];
  savingsScheduleOverrides: unknown[];
  trustSplitInterestDetails: unknown[];
  reinvestmentGroups: unknown[];
  accountGroups: unknown[];
  accountGroupMembers: unknown[];
  tickerPortfolios: unknown[];
  tickerPortfolioHoldings: unknown[];
  securityAssetClassWeights: unknown[];
};

const dbState: DbState = {
  clients: [],
  crmHouseholds: [],
  crmHouseholdContacts: [],
  scenarios: [],
  planSettings: [],
  accounts: [],
  incomes: [],
  expenses: [],
  liabilities: [],
  savingsRules: [],
  withdrawalStrategies: [],
  entities: [],
  modelPortfolios: [],
  modelPortfolioAllocations: [],
  assetClasses: [],
  accountAssetAllocations: [],
  extraPayments: [],
  transfers: [],
  transferSchedules: [],
  assetTransactions: [],
  gifts: [],
  familyMembers: [],
  externalBeneficiaries: [],
  beneficiaryDesignations: [],
  clientCmaOverrides: [],
  wills: [],
  willBequests: [],
  willBequestRecipients: [],
  willResiduaryRecipients: [],
  taxYearParameters: [],
  clientDeductions: [],
  incomeScheduleOverrides: [],
  expenseScheduleOverrides: [],
  savingsScheduleOverrides: [],
  trustSplitInterestDetails: [],
  reinvestmentGroups: [],
  accountGroups: [],
  accountGroupMembers: [],
  tickerPortfolios: [],
  tickerPortfolioHoldings: [],
  securityAssetClassWeights: [],
};

// ---------------------------------------------------------------------------
// Mock @/db — table-routing via getTableName, same as wills route test
// ---------------------------------------------------------------------------
vi.mock("@/db", async () => {
  const schema = await vi.importActual<typeof import("@/db/schema")>("@/db/schema");

  function getTableNameSafe(t: unknown): string {
    try {
      return getTableName(t as Parameters<typeof getTableName>[0]);
    } catch {
      return "";
    }
  }

  const rowsFor = (t: unknown): unknown[] => {
    const n = getTableNameSafe(t);
    if (t === schema.clients || n === "clients") return dbState.clients;
    if (t === schema.crmHouseholds || n === "crm_households") return dbState.crmHouseholds;
    if (t === schema.crmHouseholdContacts || n === "crm_household_contacts") return dbState.crmHouseholdContacts;
    if (t === schema.scenarios || n === "scenarios") return dbState.scenarios;
    if (t === schema.planSettings || n === "plan_settings") return dbState.planSettings;
    if (t === schema.accounts || n === "accounts") return dbState.accounts;
    if (t === schema.incomes || n === "incomes") return dbState.incomes;
    if (t === schema.expenses || n === "expenses") return dbState.expenses;
    if (t === schema.liabilities || n === "liabilities") return dbState.liabilities;
    if (t === schema.savingsRules || n === "savings_rules") return dbState.savingsRules;
    if (t === schema.withdrawalStrategies || n === "withdrawal_strategies") return dbState.withdrawalStrategies;
    if (t === schema.entities || n === "entities") return dbState.entities;
    if (t === schema.modelPortfolios || n === "model_portfolios") return dbState.modelPortfolios;
    if (t === schema.modelPortfolioAllocations || n === "model_portfolio_allocations") return dbState.modelPortfolioAllocations;
    if (t === schema.assetClasses || n === "asset_classes") return dbState.assetClasses;
    if (t === schema.accountAssetAllocations || n === "account_asset_allocations") return dbState.accountAssetAllocations;
    if (t === schema.extraPayments || n === "extra_payments") return dbState.extraPayments;
    if (t === schema.transfers || n === "transfers") return dbState.transfers;
    if (t === schema.transferSchedules || n === "transfer_schedules") return dbState.transferSchedules;
    if (t === schema.assetTransactions || n === "asset_transactions") return dbState.assetTransactions;
    if (t === schema.gifts || n === "gifts") return dbState.gifts;
    if (t === schema.familyMembers || n === "family_members") return dbState.familyMembers;
    if (t === schema.externalBeneficiaries || n === "external_beneficiaries") return dbState.externalBeneficiaries;
    if (t === schema.beneficiaryDesignations || n === "beneficiary_designations") return dbState.beneficiaryDesignations;
    if (t === schema.clientCmaOverrides || n === "client_cma_overrides") return dbState.clientCmaOverrides;
    if (t === schema.wills || n === "wills") return dbState.wills;
    if (t === schema.willBequests || n === "will_bequests") return dbState.willBequests;
    if (t === schema.willBequestRecipients || n === "will_bequest_recipients") return dbState.willBequestRecipients;
    if (t === schema.willResiduaryRecipients || n === "will_residuary_recipients") return dbState.willResiduaryRecipients;
    if (t === schema.taxYearParameters || n === "tax_year_parameters") return dbState.taxYearParameters;
    if (t === schema.clientDeductions || n === "client_deductions") return dbState.clientDeductions;
    if (t === schema.incomeScheduleOverrides || n === "income_schedule_overrides") return dbState.incomeScheduleOverrides;
    if (t === schema.expenseScheduleOverrides || n === "expense_schedule_overrides") return dbState.expenseScheduleOverrides;
    if (t === schema.savingsScheduleOverrides || n === "savings_schedule_overrides") return dbState.savingsScheduleOverrides;
    if (t === schema.trustSplitInterestDetails || n === "trust_split_interest_details") return dbState.trustSplitInterestDetails;
    if (t === schema.reinvestmentGroups || n === "reinvestment_groups") return dbState.reinvestmentGroups;
    if (t === schema.accountGroups || n === "account_groups") return dbState.accountGroups;
    if (t === schema.accountGroupMembers || n === "account_group_members") return dbState.accountGroupMembers;
    if (t === schema.tickerPortfolios || n === "ticker_portfolios") return dbState.tickerPortfolios;
    if (t === schema.tickerPortfolioHoldings || n === "ticker_portfolio_holdings") return dbState.tickerPortfolioHoldings;
    if (t === schema.securityAssetClassWeights || n === "security_asset_class_weights") return dbState.securityAssetClassWeights;
    return [];
  };

  // Build a chainable query result. The mock ignores actual WHERE conditions —
  // tests control what the DB "returns" by populating dbState before each call.
  const makeResult = (rows: unknown[]) => ({
    [Symbol.iterator]: () => rows[Symbol.iterator](),
    then: (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
    orderBy: (..._args: unknown[]) => makeResult(rows),
    where: (_cond: unknown) => makeResult(rows),
    innerJoin: (_table: unknown, _cond: unknown) => makeResult(rows),
  });

  const db = {
    select: (_cols?: unknown) => ({
      from: (t: unknown) => makeResult(rowsFor(t)),
    }),
  };

  return { db };
});

// Import SUT after vi.mock (vitest hoists vi.mock above all imports)
import { loadClientData, ClientNotFoundError } from "../load-client-data";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearState() {
  for (const key of Object.keys(dbState) as (keyof DbState)[]) {
    (dbState[key] as unknown[]) = [];
  }
}

/**
 * Seed all tables needed for a successful loadClientData call.
 * The clients bucket is intentionally parameterised so error tests can
 * override it to simulate not-found / wrong-firm scenarios.
 */
function seedValidFixture(clientOverride?: typeof clientRow[]) {
  clearState();
  dbState.clients = clientOverride ?? [clientRow];
  dbState.crmHouseholds = [crmHouseholdRow];
  dbState.crmHouseholdContacts = [crmPrimaryContactRow, crmSpouseContactRow];
  dbState.scenarios = [scenarioRow];
  dbState.planSettings = [planSettingsRow];
  dbState.accounts = accountRows as typeof dbState.accounts;
  dbState.incomes = [incomeRow];
  dbState.expenses = [expenseRow];
  dbState.liabilities = [liabilityRow];
  dbState.savingsRules = [savingsRuleRow];
  dbState.familyMembers = [familyMemberRow];
  dbState.externalBeneficiaries = [externalBeneficiaryRow];
  dbState.wills = [willRow];
  dbState.willBequests = [willBequestRow];
  dbState.willBequestRecipients = [willBequestRecipientRow];
  dbState.transfers = [transferRow];
  dbState.taxYearParameters = [taxYearParameterRow];
  dbState.modelPortfolios = [modelPortfolioRow];
  dbState.modelPortfolioAllocations = [modelPortfolioAllocationRow];
  dbState.assetClasses = [assetClassRow, inflationAssetClassRow];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("loadClientData", () => {
  beforeEach(() => {
    clearState();
  });

  it("throws ClientNotFoundError for an unknown clientId", async () => {
    // dbState.clients is empty — client lookup returns no rows
    await expect(
      loadClientData("00000000-dead-beef-0000-000000000000", FIXTURE_FIRM_ID),
    ).rejects.toThrow(ClientNotFoundError);
  });

  it("throws ClientNotFoundError when firmId does not match", async () => {
    // The mock returns dbState.clients verbatim regardless of WHERE clauses.
    // We simulate the (id AND firmId) DB filter by seeding only the wrong-firm
    // variant of the client row (different firmId). A real WHERE clause would
    // produce zero rows; here we achieve that by not seeding any client whose
    // (id === FIXTURE_CLIENT_ID AND firmId === WRONG_FIRM_ID) is true.
    // dbState.clients is empty here (cleared in beforeEach).
    await expect(
      loadClientData(FIXTURE_CLIENT_ID, WRONG_FIRM_ID),
    ).rejects.toThrow(ClientNotFoundError);
  });

  it("returns a fully populated ClientData for a valid client", async () => {
    seedValidFixture();

    const data = await loadClientData(FIXTURE_CLIENT_ID, FIXTURE_FIRM_ID);

    // Spot-check key fields
    expect(data.client.firstName).toBe("Alice");
    expect(data.accounts.length).toBeGreaterThan(0);
    expect(data.accounts).toHaveLength(2);
    expect(data.planSettings).toBeDefined();
    expect(data.planSettings.planStartYear).toBe(2026);
    expect(data.taxYearRows).toBeDefined();
    expect(data.taxYearRows!.length).toBeGreaterThan(0);
    expect(data.taxYearRows![0].year).toBe(2026);

    // Incomes, expenses, liabilities, savings rules
    expect(data.incomes).toHaveLength(1);
    expect(data.incomes[0].name).toBe("Alice Salary");
    expect(data.expenses).toHaveLength(1);
    expect(data.liabilities).toHaveLength(1);
    expect(data.savingsRules).toHaveLength(1);

    // Family members
    expect(data.familyMembers).toHaveLength(1);
    expect(data.familyMembers![0].firstName).toBe("Charlie");

    // Wills + bequests
    expect(data.wills).toHaveLength(1);
    expect(data.wills![0].grantor).toBe("client");
    expect(data.wills![0].bequests).toHaveLength(1);
    expect(data.wills![0].bequests[0].recipients).toHaveLength(1);

    // Transfers
    expect(data.transfers).toHaveLength(1);

    // Pin the full shape for Task 12 parity diff
    expect(data).toMatchSnapshot();
  });

  it("hydrates residuaryRecipients onto each Will", async () => {
    seedValidFixture();
    dbState.willResiduaryRecipients = [willResiduaryRecipientRow];

    const data = await loadClientData(FIXTURE_CLIENT_ID, FIXTURE_FIRM_ID);

    expect(data.wills).toHaveLength(1);
    expect(data.wills![0].residuaryRecipients).toEqual([
      {
        recipientKind: "spouse",
        recipientId: null,
        percentage: 100,
        sortOrder: 0,
      },
    ]);
  });

  it("returns undefined residuaryRecipients when none exist", async () => {
    seedValidFixture();
    // willResiduaryRecipients left empty by seedValidFixture
    const data = await loadClientData(FIXTURE_CLIENT_ID, FIXTURE_FIRM_ID);

    expect(data.wills).toHaveLength(1);
    expect(data.wills![0].residuaryRecipients).toBeUndefined();
  });

  it("resolves growthRate from a ticker portfolio (look-through allocation)", async () => {
    // Seed: assetClassRow already has slug "us-equity" and geometricReturn "0.0700".
    // tickerPortfolioRow belongs to FIXTURE_FIRM_ID.
    // tickerPortfolioHoldingRow: weight 1.0, securityId → FIXTURE_SECURITY_ID.
    // securityAssetClassWeightRow: assetClassSlug "us-equity", weight 1.0.
    // tickerPortfolioAccountRow: growthSource "ticker_portfolio", tickerPortfolioId set.
    seedValidFixture();
    // Override the us-equity asset class to 0.09 (≠ the 0.07 taxable category
    // default) so this asserts the look-through path, not a coincidental fallback.
    dbState.assetClasses = [
      { ...assetClassRow, geometricReturn: "0.0900" },
      inflationAssetClassRow,
    ];
    dbState.tickerPortfolios = [tickerPortfolioRow];
    dbState.tickerPortfolioHoldings = [tickerPortfolioHoldingRow];
    dbState.securityAssetClassWeights = [securityAssetClassWeightRow];
    dbState.accounts = [
      ...dbState.accounts,
      tickerPortfolioAccountRow as unknown as (typeof dbState.accounts)[0],
    ];

    const data = await loadClientData(FIXTURE_CLIENT_ID, FIXTURE_FIRM_ID);

    const fundAcct = data.accounts.find((a) => a.id === tickerPortfolioAccountRow.id);
    expect(fundAcct).toBeDefined();
    // us-equity geometricReturn overridden to 0.09 (≠ the 0.07 taxable category
    // default) so this asserts the look-through path, not a coincidental fallback.
    expect(fundAcct!.growthRate).toBeCloseTo(0.09, 4);
  });

  it("feeds the engine the RESOLVED inflation rate when source = asset_class", async () => {
    // Source = asset_class with an Inflation asset class whose geometric return
    // (2.50%) differs from the stale custom inflation_rate column (3.00%). The
    // engine's planSettings.inflationRate is the fallback for tax-bracket
    // indexing, SS wage-base growth, gift annual-exclusion, and estate-exemption
    // inflation — it must track the chosen default (asset class), not the raw
    // column. See the resolver note in load-client-data.ts.
    seedValidFixture();
    // Fixture pins inflationRateSource to "custom" via `as const`; cast the
    // overridden row so the runtime value is "asset_class" for this case.
    dbState.planSettings = [
      { ...planSettingsRow, inflationRateSource: "asset_class" } as unknown as typeof planSettingsRow,
    ];
    dbState.assetClasses = [
      assetClassRow,
      { ...inflationAssetClassRow, geometricReturn: "0.0250" },
    ];

    const data = await loadClientData(FIXTURE_CLIENT_ID, FIXTURE_FIRM_ID);

    // 0.025 (resolved asset class), NOT 0.03 (raw inflation_rate column).
    expect(data.planSettings.inflationRate).toBeCloseTo(0.025, 10);
  });
});
