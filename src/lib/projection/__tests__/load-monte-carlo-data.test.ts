/**
 * Pure-fixture integration tests for loadMonteCarloData.
 *
 * Approach: Plan B (pure fixture + vi.mock("@/db")).
 * No DB connection required — the mock routes each .from(table) call to the
 * matching in-memory fixture array. Additionally, db.update() is mocked to
 * support the seed-persist path.
 *
 * Two tests:
 *  1. Returns indices, correlation, accountMixes, and seed for a valid fixture.
 *  2. Regenerates and persists a seed when scenario.monteCarloSeed is null.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";

import {
  FIXTURE_FIRM_ID,
  FIXTURE_CLIENT_ID,
  FIXTURE_TICKER_ACCOUNT_ID,
  FIXTURE_ASSET_CLASS_ID,
  clientRow,
  scenarioRow,
  planSettingsRow,
  accountRows,
  modelPortfolioAllocationRow,
  assetClassRow,
  mcAccountRow,
  accountAssetAllocationRow,
  assetClassCorrelationRow,
  tickerPortfolioRow,
  tickerPortfolioHoldingRow,
  securityAssetClassWeightRow,
  tickerPortfolioAccountRow,
} from "./fixtures/sample-rows";

// ---------------------------------------------------------------------------
// DbState — mutable per-test fixture store
// ---------------------------------------------------------------------------
type ScenarioRow = Omit<typeof scenarioRow, "monteCarloSeed"> & { monteCarloSeed: number | null };

type DbState = {
  clients: typeof clientRow[];
  scenarios: ScenarioRow[];
  planSettings: typeof planSettingsRow[];
  accounts: Record<string, unknown>[];
  entities: unknown[];
  modelPortfolioAllocations: typeof modelPortfolioAllocationRow[];
  assetClasses: typeof assetClassRow[];
  accountAssetAllocations: typeof accountAssetAllocationRow[];
  // innerJoin shape: { asset_class_correlations: {...}, asset_classes: {...} }
  assetClassCorrelations: typeof assetClassCorrelationRow[];
  tickerPortfolios: unknown[];
  tickerPortfolioHoldings: unknown[];
  securityAssetClassWeights: unknown[];
};

const dbState: DbState = {
  clients: [],
  scenarios: [],
  planSettings: [],
  accounts: [],
  entities: [],
  modelPortfolioAllocations: [],
  assetClasses: [],
  accountAssetAllocations: [],
  assetClassCorrelations: [],
  tickerPortfolios: [],
  tickerPortfolioHoldings: [],
  securityAssetClassWeights: [],
};

// Track seed persists: the mock writes updated monteCarloSeed values here.
let lastPersistedSeed: number | null = null;

// ---------------------------------------------------------------------------
// Mock @/db — table-routing via getTableName + update() support
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
    if (t === schema.entities || n === "entities") return dbState.entities;
    if (t === schema.modelPortfolioAllocations || n === "model_portfolio_allocations") return dbState.modelPortfolioAllocations;
    if (t === schema.assetClasses || n === "asset_classes") return dbState.assetClasses;
    if (t === schema.accountAssetAllocations || n === "account_asset_allocations") return dbState.accountAssetAllocations;
    if (t === schema.assetClassCorrelations || n === "asset_class_correlations") return dbState.assetClassCorrelations;
    if (t === schema.tickerPortfolios || n === "ticker_portfolios") return dbState.tickerPortfolios;
    if (t === schema.tickerPortfolioHoldings || n === "ticker_portfolio_holdings") return dbState.tickerPortfolioHoldings;
    if (t === schema.securityAssetClassWeights || n === "security_asset_class_weights") return dbState.securityAssetClassWeights;
    return [];
  };

  // Build a chainable query result. The mock ignores actual WHERE / JOIN
  // conditions — tests control what the DB "returns" by populating dbState.
  const makeResult = (rows: unknown[]) => ({
    [Symbol.iterator]: () => rows[Symbol.iterator](),
    then: (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
    orderBy: (..._args: unknown[]) => makeResult(rows),
    where: (_cond: unknown) => makeResult(rows),
    limit: (_n: number) => makeResult(rows),
    innerJoin: (_table: unknown, _cond: unknown) => makeResult(rows),
  });

  // db.update(table).set(values).where(predicate)
  // For scenarios: mutate dbState.scenarios[0] and capture the seed.
  const db = {
    select: (_cols?: unknown) => ({
      from: (t: unknown) => makeResult(rowsFor(t)),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (_predicate: unknown) => {
          const n = getTableNameSafe(table);
          if (n === "scenarios" || table === schema.scenarios) {
            for (const row of dbState.scenarios) {
              Object.assign(row, values);
            }
            if (typeof values.monteCarloSeed === "number") {
              lastPersistedSeed = values.monteCarloSeed;
            }
          }
        },
      }),
    }),
  };

  return { db };
});

// Import SUT after vi.mock (vitest hoists vi.mock above all imports)
import { loadMonteCarloData } from "../load-monte-carlo-data";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearState() {
  for (const key of Object.keys(dbState) as (keyof DbState)[]) {
    (dbState[key] as unknown[]) = [];
  }
  lastPersistedSeed = null;
}

/**
 * Seed all tables needed for a successful loadMonteCarloData call.
 * mcAccountRow uses growthSource: "model_portfolio" so it produces an
 * accountMix, making indices non-empty.
 */
function seedValidFixture(scenarioOverride?: { monteCarloSeed?: number | null }) {
  clearState();
  dbState.clients = [clientRow];
  dbState.scenarios = [{ ...scenarioRow, monteCarloSeed: null, ...scenarioOverride }];
  dbState.planSettings = [planSettingsRow];
  // Include base accounts (custom growth) + MC account (model_portfolio)
  dbState.accounts = [...accountRows, mcAccountRow] as Record<string, unknown>[];
  dbState.modelPortfolioAllocations = [modelPortfolioAllocationRow];
  dbState.assetClasses = [assetClassRow];
  dbState.accountAssetAllocations = [accountAssetAllocationRow];
  dbState.assetClassCorrelations = [assetClassCorrelationRow];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("loadMonteCarloData", () => {
  beforeEach(() => {
    clearState();
  });

  it("returns indices, correlation, accountMixes, and seed", async () => {
    // Seed with a pre-existing seed so no DB update is triggered.
    seedValidFixture({ monteCarloSeed: 12345678 });

    const payload = await loadMonteCarloData(FIXTURE_CLIENT_ID, FIXTURE_FIRM_ID);

    expect(payload.indices.length).toBeGreaterThan(0);
    expect(payload.correlation.length).toBe(payload.indices.length);
    expect(payload.correlation[0].length).toBe(payload.indices.length);
    expect(typeof payload.seed).toBe("number");
    expect(payload.seed).toBe(12345678);
    // accountMixes should contain the IRA account driven by the model portfolio.
    expect(payload.accountMixes.length).toBeGreaterThan(0);
    // startingLiquidBalance sums taxable + cash + retirement accounts in-estate.
    expect(payload.startingLiquidBalance).toBeGreaterThan(0);

    expect(payload).toMatchSnapshot({ seed: expect.any(Number) });
  });

  it("regenerates and persists seed when scenario has null monteCarloSeed", async () => {
    // Seed with monteCarloSeed: null — loadMonteCarloData should generate one
    // and persist it via db.update(scenarios).
    seedValidFixture({ monteCarloSeed: null });

    expect(dbState.scenarios[0].monteCarloSeed).toBeNull();

    const payload = await loadMonteCarloData(FIXTURE_CLIENT_ID, FIXTURE_FIRM_ID);

    // Returned seed is a positive integer in the signed-int32 range.
    expect(typeof payload.seed).toBe("number");
    expect(payload.seed).toBeGreaterThan(0);
    expect(payload.seed).toBeLessThan(0x7fffffff);

    // The mock's update path should have mutated dbState.scenarios[0].
    expect(dbState.scenarios[0].monteCarloSeed).toBe(payload.seed);

    // lastPersistedSeed captured in the mock's update path.
    expect(lastPersistedSeed).toBe(payload.seed);
  });

  it("base path (no effective tree) leaves startingLiquidBalance at the base value", async () => {
    seedValidFixture({ monteCarloSeed: 12345678 });
    const payload = await loadMonteCarloData(FIXTURE_CLIENT_ID, FIXTURE_FIRM_ID);
    // taxable 250k + cash 30k + retirement (IRA) 100k
    expect(payload.startingLiquidBalance).toBe(380000);
  });

  it("uses the effective tree's accounts for startingLiquidBalance when provided", async () => {
    seedValidFixture({ monteCarloSeed: 12345678 });
    // Effective tree mirrors base liquid accounts plus one extra in-estate
    // taxable account that base doesn't have → balance rises by 20k.
    const effectiveTree = {
      accounts: [
        { id: "00000000-0000-0000-0000-000000000020", category: "taxable", value: 250000, owners: [] },
        { id: "00000000-0000-0000-0000-000000000021", category: "cash", value: 30000, owners: [] },
        { id: "00000000-0000-0000-0000-000000000022", category: "retirement", value: 100000, owners: [] },
        { id: "added-1", category: "taxable", value: 20000, owners: [] },
      ],
      entities: [],
    };
    const payload = await loadMonteCarloData(
      FIXTURE_CLIENT_ID,
      FIXTURE_FIRM_ID,
      "base",
      [],
      effectiveTree as never,
    );
    expect(payload.startingLiquidBalance).toBe(400000);
  });

  it("ticker_portfolio account contributes look-through mix to accountMixes", async () => {
    // Seed the base fixtures plus a ticker portfolio account. The account has
    // growthSource: "ticker_portfolio" and tickerPortfolioId pointing at
    // tickerPortfolioRow. The holding resolves through securityAssetClassWeightRow
    // (slug "us-equity") to FIXTURE_ASSET_CLASS_ID.
    //
    // Non-vacuity: a ticker_portfolio account with NO branch in the mix builder
    // would produce an empty mix and be ABSENT from accountMixes entirely. So
    // finding the entry AND checking its assetClassId is a meaningful assertion —
    // it proves the look-through path ran, not some fallback.
    seedValidFixture({ monteCarloSeed: 12345678 });
    dbState.tickerPortfolios = [tickerPortfolioRow];
    dbState.tickerPortfolioHoldings = [tickerPortfolioHoldingRow];
    dbState.securityAssetClassWeights = [securityAssetClassWeightRow];
    dbState.accounts = [
      ...dbState.accounts,
      tickerPortfolioAccountRow as Record<string, unknown>,
    ];

    const payload = await loadMonteCarloData(FIXTURE_CLIENT_ID, FIXTURE_FIRM_ID);

    const entry = payload.accountMixes.find((m) => m.accountId === FIXTURE_TICKER_ACCOUNT_ID);
    expect(entry).toBeDefined();
    expect(entry!.segments).toEqual([{ fromYear: 0, mix: expect.any(Array) }]);
    const mix = entry!.segments[0].mix;
    expect(mix.length).toBeGreaterThan(0);
    // The look-through should resolve to FIXTURE_ASSET_CLASS_ID (us-equity).
    expect(mix[0].assetClassId).toBe(FIXTURE_ASSET_CLASS_ID);
    // Weight should be 1.0 (holding weight 1 × security weight 1).
    expect(mix[0].weight).toBeCloseTo(1.0, 4);
  });
});
