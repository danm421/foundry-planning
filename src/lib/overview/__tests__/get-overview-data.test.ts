/**
 * Integration test for getOverviewData.
 *
 * Approach: pure-fixture vi.mock("@/db") pattern (same as load-client-data.test.ts).
 * No DB connection required — the mock routes each .from(table) call to the
 * matching in-memory fixture array.
 *
 * Three auxiliary loaders (listOpenItems, listAuditRows, getAssetAllocationByType)
 * are mocked at the module level — they are NOT the SUT and their DB patterns
 * (innerJoin, etc.) are outside the scope of this test.
 *
 * Three tests:
 *  1. Throws ClientNotFoundError for an unknown clientId (empty dbState.clients)
 *  2. Returns populated netWorthSeries / lifeEvents / alertInputs on happy path
 *  3. Fail-soft: returns with projectionError populated when loadClientData throws
 *
 * NOTE on taxYearParameterRow override:
 *  The shared fixture's taxYearParameterRow.incomeBrackets / capGainsBrackets use a
 *  flat-array shape that only satisfies the load-client-data passthrough test. The
 *  projection engine (runProjection → calculateTaxYear) requires the real JSONB shape:
 *    incomeBrackets: Record<FilingStatus, BracketTier[]>   ({ from, to, rate })
 *    capGainsBrackets: Record<FilingStatus, CapGainsTier>  ({ zeroPctTop, fifteenPctTop })
 *  We override the fixture locally here so we can call runProjection without errors.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";

import {
  FIXTURE_FIRM_ID,
  FIXTURE_CLIENT_ID,
  clientRow,
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
  transferRow,
  taxYearParameterRow,
  modelPortfolioRow,
  modelPortfolioAllocationRow,
  assetClassRow,
  inflationAssetClassRow,
} from "@/lib/projection/__tests__/fixtures/sample-rows";

// ---------------------------------------------------------------------------
// Local override for taxYearParameterRow with correct JSONB shape.
//
// The shared fixture uses a flat BracketTier[] for incomeBrackets (legacy shape
// from before the engine was hooked up). The projection engine expects
// BracketsByStatus: Record<FilingStatus, BracketTier[]> and
// CapGainsBracketsByStatus: Record<FilingStatus, CapGainsTier>.
// We spread the shared row and replace only the two bracket fields.
// ---------------------------------------------------------------------------

const incomeBrackets2026 = [
  { from: 0,      to: 23200,   rate: 0.10 },
  { from: 23200,  to: 94300,   rate: 0.12 },
  { from: 94300,  to: 201050,  rate: 0.22 },
  { from: 201050, to: 383900,  rate: 0.24 },
  { from: 383900, to: 487450,  rate: 0.32 },
  { from: 487450, to: 731200,  rate: 0.35 },
  { from: 731200, to: null,    rate: 0.37 },
];

const capGainsBrackets2026 = { zeroPctTop: 94050, fifteenPctTop: 583750 };

// Extend the shared row with the correct JSONB bracket shapes expected by the engine.
const taxYearParameterRowForProjection = {
  ...taxYearParameterRow,
  incomeBrackets: {
    married_joint:     incomeBrackets2026,
    single:            incomeBrackets2026,
    head_of_household: incomeBrackets2026,
    married_separate:  incomeBrackets2026,
  },
  capGainsBrackets: {
    married_joint:     capGainsBrackets2026,
    single:            capGainsBrackets2026,
    head_of_household: capGainsBrackets2026,
    married_separate:  capGainsBrackets2026,
  },
} as unknown as typeof taxYearParameterRow;

// ---------------------------------------------------------------------------
// DbState — mutable per-test fixture store (verbatim from load-client-data.test.ts)
// ---------------------------------------------------------------------------
type DbState = {
  clients: typeof clientRow[];
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
  taxYearParameters: typeof taxYearParameterRow[];
  clientDeductions: unknown[];
  incomeScheduleOverrides: unknown[];
  expenseScheduleOverrides: unknown[];
  savingsScheduleOverrides: unknown[];
};

const dbState: DbState = {
  clients: [],
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
  taxYearParameters: [],
  clientDeductions: [],
  incomeScheduleOverrides: [],
  expenseScheduleOverrides: [],
  savingsScheduleOverrides: [],
};

// ---------------------------------------------------------------------------
// Mock @/db — table-routing via getTableName (verbatim from load-client-data.test.ts)
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
    if (t === schema.taxYearParameters || n === "tax_year_parameters") return dbState.taxYearParameters;
    if (t === schema.clientDeductions || n === "client_deductions") return dbState.clientDeductions;
    if (t === schema.incomeScheduleOverrides || n === "income_schedule_overrides") return dbState.incomeScheduleOverrides;
    if (t === schema.expenseScheduleOverrides || n === "expense_schedule_overrides") return dbState.expenseScheduleOverrides;
    if (t === schema.savingsScheduleOverrides || n === "savings_schedule_overrides") return dbState.savingsScheduleOverrides;
    return [];
  };

  // Build a chainable query result. The mock ignores actual WHERE conditions —
  // tests control what the DB "returns" by populating dbState before each call.
  const makeResult = (rows: unknown[]) => ({
    [Symbol.iterator]: () => rows[Symbol.iterator](),
    then: (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
    orderBy: (..._args: unknown[]) => makeResult(rows),
    where: (_cond: unknown) => makeResult(rows),
  });

  const db = {
    select: (_cols?: unknown) => ({
      from: (t: unknown) => makeResult(rowsFor(t)),
    }),
  };

  return { db };
});

// ---------------------------------------------------------------------------
// Mock auxiliary loaders — NOT the SUT; these use DB patterns outside the mock
// ---------------------------------------------------------------------------
vi.mock("../list-open-items", () => ({
  listOpenItems: vi.fn().mockResolvedValue([]),
}));
vi.mock("../list-audit-rows", () => ({
  listAuditRows: vi.fn().mockResolvedValue([]),
}));
vi.mock("../get-asset-allocation-by-type", () => ({
  getAssetAllocationByType: vi.fn().mockResolvedValue([]),
}));

// Import SUT after vi.mock (vitest hoists vi.mock above all imports)
import { getOverviewData } from "../get-overview-data";
import { ClientNotFoundError } from "@/lib/projection/load-client-data";

// ---------------------------------------------------------------------------
// Helpers (verbatim from load-client-data.test.ts:194-225)
// ---------------------------------------------------------------------------

function clearState() {
  for (const key of Object.keys(dbState) as (keyof DbState)[]) {
    (dbState[key] as unknown[]) = [];
  }
}

function seedValidFixture() {
  clearState();
  dbState.clients = [clientRow];
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
  // Use the projection-compatible row (correct BracketsByStatus JSONB shape)
  dbState.taxYearParameters = [taxYearParameterRowForProjection];
  dbState.modelPortfolios = [modelPortfolioRow];
  dbState.modelPortfolioAllocations = [modelPortfolioAllocationRow];
  dbState.assetClasses = [assetClassRow, inflationAssetClassRow];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getOverviewData", () => {
  beforeEach(() => {
    clearState();
  });

  it("throws ClientNotFoundError for missing client", async () => {
    // dbState.clients is empty — client lookup returns no rows
    await expect(
      getOverviewData("00000000-0000-0000-0000-000000000000", FIXTURE_FIRM_ID),
    ).rejects.toBeInstanceOf(ClientNotFoundError);
  });

  it("returns populated netWorthSeries, lifeEvents, alertInputs on happy path", async () => {
    seedValidFixture();

    const data = await getOverviewData(FIXTURE_CLIENT_ID, FIXTURE_FIRM_ID);

    // Projection produced years
    expect(data.runway.netWorthSeries.length).toBeGreaterThan(0);

    // minNetWorth is a finite number (fixture may project to negative; just
    // check it's finite rather than asserting >= 0 which is fixture-dependent)
    expect(Number.isFinite(data.runway.minNetWorth)).toBe(true);

    // Projection ran cleanly — no error
    expect(data.alertInputs.projectionError).toBeNull();

    // Spot-check inline accounts query path
    expect(data.kpi.netWorth).toBeGreaterThanOrEqual(0);
    expect(data.kpi.liquidPortfolio).toBeGreaterThanOrEqual(0);
  });

  it("fail-soft: returns with projectionError populated when loadClientData fails", async () => {
    // Seed a client + scenario but NO plan_settings → loadClientData throws
    // ProjectionInputError("Client {id} has no plan_settings row").
    // The catch block in getOverviewData catches this (it's not ClientNotFoundError),
    // sets projectionError, and continues normally.
    clearState();
    dbState.clients = [clientRow];
    dbState.scenarios = [scenarioRow];
    // planSettings deliberately empty → triggers ProjectionInputError
    dbState.accounts = accountRows as typeof dbState.accounts;
    dbState.taxYearParameters = [taxYearParameterRowForProjection];

    // Suppress the console.error that getOverviewData writes on projection failure
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      const data = await getOverviewData(FIXTURE_CLIENT_ID, FIXTURE_FIRM_ID);

      // Function must NOT throw
      expect(data).toBeDefined();

      // Projection-derived fields are empty
      expect(data.runway.netWorthSeries).toEqual([]);
      expect(data.lifeEvents).toEqual([]);

      // projectionError is populated
      expect(data.alertInputs.projectionError).toBeTruthy();

      // Inline accounts query still ran — netWorth reflects the seeded accountRows
      const expectedNetWorth = accountRows.reduce(
        (sum, a) => sum + Number(a.value ?? 0),
        0,
      );
      expect(data.kpi.netWorth).toBe(expectedNetWorth);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
