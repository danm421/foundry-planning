/**
 * Integration tests for the entity cash-account backfill script.
 * Exercises real DB via Drizzle. Requires DATABASE_URL — suite is skipped
 * in CI if unavailable. Mirrors the pattern used in
 * `src/app/api/clients/[id]/accounts/__tests__/owners.test.ts`.
 *
 * Each test seeds a throwaway client (`firmId = TEST_FIRM`) and tears it
 * down via FK cascade so the dev branch stays clean.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";

// Load .env.local before anything that reads DATABASE_URL at module-init time.
try {
  const envPath = resolve(process.cwd(), ".env.local");
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (process.env[k]) continue;
    let v = vRaw.trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
} catch {
  // .env.local not present — the skipIf below handles this.
}

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const TEST_FIRM = "firm_backfill_entity_cash_test";

d("backfillEntityCashAccounts", () => {
  let dbMod: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let drizzleOrm: typeof import("drizzle-orm");
  let backfillEntityCashAccounts: (opts?: { clientId?: string }) => Promise<number>;

  beforeAll(async () => {
    dbMod = await import("@/db");
    schema = await import("@/db/schema");
    drizzleOrm = await import("drizzle-orm");
    ({ backfillEntityCashAccounts } = await import(
      "../backfill-entity-cash-accounts"
    ));
  });

  async function cleanup() {
    const { db } = dbMod;
    const { clients, scenarios, entities } = schema;
    const { inArray, sql, eq } = drizzleOrm;

    const testClients = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.firmId, TEST_FIRM));
    const ids = testClients.map((c) => c.id);
    if (ids.length === 0) return;

    // The default-checking trigger fires AFTER on account_owners; deleting an
    // entity cascades to account_owners but the trigger checks a raw count
    // mid-cascade. Disable the relevant triggers for the duration of cleanup.
    await db.execute(
      sql`ALTER TABLE account_owners DISABLE TRIGGER account_owners_sum_check`,
    );
    await db.execute(
      sql`ALTER TABLE account_owners DISABLE TRIGGER account_owners_default_checking_check`,
    );
    try {
      await db.delete(entities).where(inArray(entities.clientId, ids));
      await db.delete(scenarios).where(inArray(scenarios.clientId, ids));
      await db.delete(clients).where(eq(clients.firmId, TEST_FIRM));
    } finally {
      await db.execute(
        sql`ALTER TABLE account_owners ENABLE TRIGGER account_owners_sum_check`,
      );
      await db.execute(
        sql`ALTER TABLE account_owners ENABLE TRIGGER account_owners_default_checking_check`,
      );
    }
  }

  async function setupClientWithEntity(name = "Test Trust") {
    const { db } = dbMod;
    const { clients, scenarios, entities } = schema;

    const [client] = await db
      .insert(clients)
      .values({
        firmId: TEST_FIRM,
        advisorId: "advisor_backfill_entity_cash_test",
        firstName: "Backfill",
        lastName: "EntityCash",
        dateOfBirth: "1970-01-01",
        retirementAge: 65,
        planEndAge: 90,
        lifeExpectancy: 90,
        filingStatus: "married_joint",
        spouseName: "Spouse",
        spouseLastName: "Test",
      })
      .returning();

    const [scenario] = await db
      .insert(scenarios)
      .values({ clientId: client.id, name: "base", isBaseCase: true })
      .returning();

    const [entity] = await db
      .insert(entities)
      .values({
        clientId: client.id,
        name,
        entityType: "trust" as const,
      })
      .returning();

    return { clientId: client.id, scenarioId: scenario.id, entityId: entity.id };
  }

  beforeEach(async () => {
    await cleanup();
  });

  // Belt-and-suspenders: also clean up after the suite so the dev branch
  // doesn't accumulate orphan TEST_FIRM clients between runs.
  afterAll(async () => {
    await cleanup();
  });

  it("creates a default checking for an entity that lacks one", async () => {
    const { db } = dbMod;
    const { accounts, accountOwners } = schema;
    const { eq, and } = drizzleOrm;

    const { clientId, entityId, scenarioId } = await setupClientWithEntity(
      "Backfill Trust",
    );

    await backfillEntityCashAccounts({ clientId });

    const owned = await db
      .select({ id: accounts.id, name: accounts.name, percent: accountOwners.percent })
      .from(accounts)
      .innerJoin(accountOwners, eq(accountOwners.accountId, accounts.id))
      .where(
        and(
          eq(accounts.scenarioId, scenarioId),
          eq(accountOwners.entityId, entityId),
          eq(accounts.isDefaultChecking, true),
        ),
      );

    expect(owned).toHaveLength(1);
    expect(owned[0].name).toBe("Backfill Trust — Cash");
    expect(Number(owned[0].percent)).toBe(1);
  });

  it("is idempotent — re-running creates no duplicates", async () => {
    const { db } = dbMod;
    const { accounts, accountOwners } = schema;
    const { eq, and } = drizzleOrm;

    const { clientId, entityId, scenarioId } = await setupClientWithEntity(
      "Idempotent Trust",
    );

    await backfillEntityCashAccounts({ clientId });
    await backfillEntityCashAccounts({ clientId });
    await backfillEntityCashAccounts({ clientId });

    const owned = await db
      .select({ id: accounts.id })
      .from(accounts)
      .innerJoin(accountOwners, eq(accountOwners.accountId, accounts.id))
      .where(
        and(
          eq(accounts.scenarioId, scenarioId),
          eq(accountOwners.entityId, entityId),
          eq(accounts.isDefaultChecking, true),
        ),
      );

    expect(owned).toHaveLength(1);
  });

  it("skips entities whose client has no base scenario", async () => {
    const { db } = dbMod;
    const { clients, entities, accounts, accountOwners } = schema;
    const { eq } = drizzleOrm;

    // Client + entity but no base scenario at all.
    const [client] = await db
      .insert(clients)
      .values({
        firmId: TEST_FIRM,
        advisorId: "advisor_backfill_entity_cash_test",
        firstName: "NoBase",
        lastName: "Scenario",
        dateOfBirth: "1970-01-01",
        retirementAge: 65,
        planEndAge: 90,
        lifeExpectancy: 90,
        filingStatus: "single",
      })
      .returning();
    const [entity] = await db
      .insert(entities)
      .values({
        clientId: client.id,
        name: "Orphan Entity",
        entityType: "trust" as const,
      })
      .returning();

    await backfillEntityCashAccounts({ clientId: client.id });

    // No accounts should have been created for this entity.
    const owned = await db
      .select({ id: accounts.id })
      .from(accounts)
      .innerJoin(accountOwners, eq(accountOwners.accountId, accounts.id))
      .where(eq(accountOwners.entityId, entity.id));

    expect(owned).toHaveLength(0);
  });
});
