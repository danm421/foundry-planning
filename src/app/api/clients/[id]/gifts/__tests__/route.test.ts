/**
 * Integration tests for POST /api/clients/[id]/gifts.
 * Exercises real DB via Drizzle. Requires DATABASE_URL — suite is skipped
 * in CI if unavailable.
 *
 * Covers:
 *  1. Cash gift creation — amount set, accountId/liabilityId null.
 *  2. Asset transfer with linked liability — parent gift + auto-bundled child gift.
 *  3. Asset transfer without linked liability — no child gift row created.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

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

vi.mock("@/lib/db-helpers", () => ({
  getOrgId: vi.fn(),
  requireOrgId: vi.fn(),
}));

// Suppress audit noise in tests (gifts route does not currently call recordCreate,
// but mock it defensively so future additions don't break the suite).
vi.mock("@/lib/audit", () => ({
  recordCreate: vi.fn().mockResolvedValue(undefined),
  recordUpdate: vi.fn().mockResolvedValue(undefined),
  recordDelete: vi.fn().mockResolvedValue(undefined),
}));

const TEST_FIRM = "firm_gifts_route_test";

d("POST /api/clients/[id]/gifts", () => {
  let dbMod: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let helpers: typeof import("@/lib/db-helpers");
  let drizzleOrm: typeof import("drizzle-orm");
  let POST: (typeof import("../route"))["POST"];

  beforeAll(async () => {
    dbMod = await import("@/db");
    schema = await import("@/db/schema");
    helpers = await import("@/lib/db-helpers");
    drizzleOrm = await import("drizzle-orm");
    ({ POST } = await import("../route"));
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  async function cleanup() {
    const { db } = dbMod;
    const { clients, scenarios, familyMembers, entities } = schema;

    const testClients = await db
      .select({ id: clients.id })
      .from(clients)
      .where(drizzleOrm.eq(clients.firmId, TEST_FIRM));
    const ids = testClients.map((c) => c.id);
    if (ids.length === 0) return;

    // Delete gifts first to avoid the gifts_event_kind check constraint firing
    // when accounts cascade-set-null on account_id (which would leave percent
    // set on a row with no amount/accountId/liabilityId).
    await db.delete(schema.gifts).where(drizzleOrm.inArray(schema.gifts.clientId, ids));
    // Delete entities before cascading clients (avoids FK issues with client cascade)
    await db.delete(entities).where(drizzleOrm.inArray(entities.clientId, ids));
    await db.delete(scenarios).where(drizzleOrm.inArray(scenarios.clientId, ids));
    await db.delete(familyMembers).where(drizzleOrm.inArray(familyMembers.clientId, ids));
    await db.delete(clients).where(drizzleOrm.eq(clients.firmId, TEST_FIRM));
  }

  /**
   * Seeds a minimal client + scenario + one family member (needed as gift recipient).
   * Returns clientId, scenarioId, familyMemberId.
   */
  async function setupClient() {
    const { db } = dbMod;
    const { clients, scenarios, familyMembers, entities } = schema;

    const [client] = await db
      .insert(clients)
      .values({
        firmId: TEST_FIRM,
        advisorId: "advisor_gifts_test",
        firstName: "Gift",
        lastName: "Test",
        dateOfBirth: "1970-01-01",
        retirementAge: 65,
        planEndAge: 90,
        lifeExpectancy: 90,
        filingStatus: "single",
      })
      .returning();

    const [scenario] = await db
      .insert(scenarios)
      .values({ clientId: client.id, name: "base", isBaseCase: true })
      .returning();

    const [fm] = await db
      .insert(familyMembers)
      .values({
        clientId: client.id,
        firstName: "Gift",
        lastName: "Test",
        role: "client" as const,
      })
      .returning();

    const [entity] = await db
      .insert(entities)
      .values({
        clientId: client.id,
        name: "Test Trust",
        entityType: "trust" as const,
        isIrrevocable: true,
      })
      .returning();

    return {
      clientId: client.id,
      scenarioId: scenario.id,
      familyMemberId: fm.id,
      entityId: entity.id,
    };
  }

  function makePostReq(clientId: string, body: object): Request {
    return new Request(`http://localhost/api/clients/${clientId}/gifts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // ── setup / teardown ──────────────────────────────────────────────────────

  beforeEach(async () => {
    await cleanup();
    vi.mocked(helpers.getOrgId).mockResolvedValue(TEST_FIRM);
  });

  // ── tests ──────────────────────────────────────────────────────────────────

  it("1. Cash gift — amount set, accountId/liabilityId null, status 201", async () => {
    const { clientId, familyMemberId } = await setupClient();

    const res = await POST(
      makePostReq(clientId, {
        year: 2026,
        amount: 18000,
        grantor: "client",
        recipientFamilyMemberId: familyMemberId,
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );

    expect(res.status).toBe(201);
    const row = await res.json();
    expect(row.amount).toBe("18000.00");
    expect(row.accountId).toBeNull();
    expect(row.liabilityId).toBeNull();
    expect(row.percent).toBeNull();
    expect(row.parentGiftId).toBeNull();
  });

  it("2. Asset transfer with linked liability — creates parent + child gift", async () => {
    const { clientId, scenarioId, entityId } = await setupClient();
    const { db } = dbMod;
    const { accounts, liabilities, gifts } = schema;

    // Seed a real-estate account
    const [account] = await db
      .insert(accounts)
      .values({
        clientId,
        scenarioId,
        name: "Rental Property",
        category: "real_estate" as const,
        subType: "rental_property",
        owner: "client",
        value: "500000",
        basis: "200000",
      })
      .returning();

    // Seed a liability linked to the account
    const [liability] = await db
      .insert(liabilities)
      .values({
        clientId,
        scenarioId,
        name: "Rental Mortgage",
        balance: "250000",
        interestRate: "0.065",
        monthlyPayment: "1500",
        startYear: 2020,
        termMonths: 360,
        linkedPropertyId: account.id,
      })
      .returning();

    const res = await POST(
      makePostReq(clientId, {
        year: 2026,
        grantor: "client",
        recipientEntityId: entityId,
        accountId: account.id,
        percent: 0.5,
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );

    expect(res.status).toBe(201);
    const parentRow = await res.json();

    // Parent gift assertions
    expect(parentRow.accountId).toBe(account.id);
    expect(parseFloat(parentRow.percent)).toBeCloseTo(0.5, 4);
    expect(parentRow.parentGiftId).toBeNull();
    expect(parentRow.liabilityId).toBeNull();

    // Child gift must exist
    const children = await db
      .select()
      .from(gifts)
      .where(drizzleOrm.eq(gifts.parentGiftId, parentRow.id));

    expect(children).toHaveLength(1);
    const child = children[0];
    expect(child.liabilityId).toBe(liability.id);
    expect(parseFloat(child.percent!)).toBeCloseTo(0.5, 4);
    expect(child.year).toBe(2026);
    expect(child.grantor).toBe("client");
    // Child should NOT set accountId (it's a liability-only row)
    expect(child.accountId).toBeNull();
  });

  it("3. Asset transfer without linked liability — no child gift created", async () => {
    const { clientId, scenarioId, entityId } = await setupClient();
    const { db } = dbMod;
    const { accounts, gifts } = schema;

    // Seed a brokerage account (no linked liability)
    const [account] = await db
      .insert(accounts)
      .values({
        clientId,
        scenarioId,
        name: "Brokerage Account",
        category: "taxable" as const,
        subType: "brokerage",
        owner: "client",
        value: "100000",
        basis: "80000",
      })
      .returning();

    const res = await POST(
      makePostReq(clientId, {
        year: 2026,
        grantor: "client",
        recipientEntityId: entityId,
        accountId: account.id,
        percent: 1.0,
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );

    expect(res.status).toBe(201);
    const parentRow = await res.json();
    expect(parentRow.accountId).toBe(account.id);

    // No child gifts
    const children = await db
      .select()
      .from(gifts)
      .where(drizzleOrm.eq(gifts.parentGiftId, parentRow.id));

    expect(children).toHaveLength(0);
  });
});
