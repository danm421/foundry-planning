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
  clientRow,
  scenarioRow,
  planSettingsRow,
  accountRows,
  modelPortfolioAllocationRow,
  assetClassRow,
  mcAccountRow,
  accountAssetAllocationRow,
  assetClassCorrelationRow,
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
});
