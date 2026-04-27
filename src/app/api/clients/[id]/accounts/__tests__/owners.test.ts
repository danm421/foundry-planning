/**
 * Integration tests for account owners[] payload: POST and PUT.
 * Exercises real DB via Drizzle. Requires DATABASE_URL — suite is skipped
 * in CI if unavailable (structural tests still enforce tenant isolation).
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

// Suppress audit noise in tests
vi.mock("@/lib/audit", () => ({
  recordCreate: vi.fn().mockResolvedValue(undefined),
  recordUpdate: vi.fn().mockResolvedValue(undefined),
  recordDelete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/audit/snapshots/account", () => ({
  toAccountSnapshot: vi.fn().mockResolvedValue({}),
  ACCOUNT_FIELD_LABELS: {},
}));

// db-scoping: passthrough for these tests (ownership FK validation handles tenant isolation)
vi.mock("@/lib/db-scoping", () => ({
  assertEntitiesInClient: vi.fn().mockResolvedValue({ ok: true }),
  assertModelPortfoliosInFirm: vi.fn().mockResolvedValue({ ok: true }),
}));

const TEST_FIRM = "firm_owners_test";

d("Account owners[] API — POST and PUT", () => {
  let dbMod: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let helpers: typeof import("@/lib/db-helpers");
  let drizzleOrm: typeof import("drizzle-orm");

  let POST: (typeof import("../route"))["POST"];
  let PUT: (typeof import("../[accountId]/route"))["PUT"];

  beforeAll(async () => {
    dbMod = await import("@/db");
    schema = await import("@/db/schema");
    helpers = await import("@/lib/db-helpers");
    drizzleOrm = await import("drizzle-orm");
    ({ POST } = await import("../route"));
    ({ PUT } = await import("../[accountId]/route"));
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  async function cleanup() {
    const { db } = dbMod;
    const { clients, scenarios, familyMembers, entities } = schema;
    const { inArray, sql } = drizzleOrm;

    const testClients = await db
      .select({ id: clients.id })
      .from(clients)
      .where(drizzleOrm.eq(clients.firmId, TEST_FIRM));
    const ids = testClients.map((c) => c.id);
    if (ids.length === 0) return;

    // The sum-check trigger fires at commit and raises if any account_owners row is deleted
    // while its parent account still exists with zero remaining owners. Disable the trigger
    // for the cleanup transaction only so cascade deletes don't trip the invariant.
    await db.execute(sql`ALTER TABLE account_owners DISABLE TRIGGER account_owners_sum_check`);
    await db.execute(sql`ALTER TABLE account_owners DISABLE TRIGGER account_owners_retirement_check`);
    await db.execute(sql`ALTER TABLE account_owners DISABLE TRIGGER account_owners_default_checking_check`);
    try {
      // Deleting clients cascades to accounts → account_owners automatically.
      await db.delete(entities).where(inArray(entities.clientId, ids));
      await db.delete(scenarios).where(inArray(scenarios.clientId, ids));
      await db.delete(familyMembers).where(inArray(familyMembers.clientId, ids));
      await db.delete(clients).where(drizzleOrm.eq(clients.firmId, TEST_FIRM));
    } finally {
      await db.execute(sql`ALTER TABLE account_owners ENABLE TRIGGER account_owners_sum_check`);
      await db.execute(sql`ALTER TABLE account_owners ENABLE TRIGGER account_owners_retirement_check`);
      await db.execute(sql`ALTER TABLE account_owners ENABLE TRIGGER account_owners_default_checking_check`);
    }
  }

  /**
   * Seeds a firm + client + scenario + two family members (client + spouse) +
   * optional entity. Returns all seeded IDs.
   */
  async function setupClient(opts?: { withSpouse?: boolean; withEntity?: boolean }) {
    const { db } = dbMod;
    const { clients, scenarios, familyMembers, entities } = schema;

    const [client] = await db
      .insert(clients)
      .values({
        firmId: TEST_FIRM,
        advisorId: "advisor_owners_test",
        firstName: "Owners",
        lastName: "Test",
        dateOfBirth: "1970-01-01",
        retirementAge: 65,
        planEndAge: 90,
        lifeExpectancy: 90,
        filingStatus: "married_joint",
        spouseName: opts?.withSpouse !== false ? "Spouse" : undefined,
        spouseLastName: opts?.withSpouse !== false ? "Test" : undefined,
      })
      .returning();

    const [scenario] = await db
      .insert(scenarios)
      .values({ clientId: client.id, name: "base", isBaseCase: true })
      .returning();

    // client-role family member
    const [clientFm] = await db
      .insert(familyMembers)
      .values({
        clientId: client.id,
        firstName: "Owners",
        lastName: "Test",
        role: "client" as const,
      })
      .returning();

    let spouseFm: { id: string } | undefined;
    if (opts?.withSpouse !== false) {
      [spouseFm] = await db
        .insert(familyMembers)
        .values({
          clientId: client.id,
          firstName: "Spouse",
          lastName: "Test",
          role: "spouse" as const,
        })
        .returning();
    }

    let entityRow: { id: string } | undefined;
    if (opts?.withEntity) {
      [entityRow] = await db
        .insert(entities)
        .values({
          clientId: client.id,
          name: "Test Trust",
          entityType: "trust" as const,
        })
        .returning();
    }

    return {
      clientId: client.id,
      scenarioId: scenario.id,
      clientFmId: clientFm.id,
      spouseFmId: spouseFm?.id,
      entityId: entityRow?.id,
    };
  }

  function makePostReq(clientId: string, body: object): Request {
    return new Request(`http://localhost/api/clients/${clientId}/accounts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function makePutReq(clientId: string, accountId: string, body: object): Request {
    return new Request(
      `http://localhost/api/clients/${clientId}/accounts/${accountId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }

  // ── setup / teardown ─────────────────────────────────────────────────────

  beforeEach(async () => {
    await cleanup();
    vi.mocked(helpers.requireOrgId).mockResolvedValue(TEST_FIRM);
  });

  // ── tests ─────────────────────────────────────────────────────────────────

  it("1. POST with valid owners[3] summing to 100% → 201 + 3 account_owners rows", async () => {
    const { clientId, clientFmId, spouseFmId, entityId } = await setupClient({ withEntity: true });

    const res = await POST(
      makePostReq(clientId, {
        name: "Three Owner Account",
        category: "taxable",
        subType: "brokerage",
        owner: "joint",
        owners: [
          { kind: "family_member", familyMemberId: clientFmId, percent: 0.5 },
          { kind: "family_member", familyMemberId: spouseFmId!, percent: 0.25 },
          { kind: "entity", entityId: entityId!, percent: 0.25 },
        ],
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    const { db } = dbMod;
    const { accountOwners } = schema;
    const rows = await db
      .select()
      .from(accountOwners)
      .where(drizzleOrm.eq(accountOwners.accountId, body.id));
    expect(rows).toHaveLength(3);
  });

  it("2. POST with owners summing to 90% → 400 matching /sum.*100/i", async () => {
    const { clientId, clientFmId, spouseFmId } = await setupClient();

    const res = await POST(
      makePostReq(clientId, {
        name: "Bad Sum Account",
        category: "taxable",
        subType: "brokerage",
        owner: "joint",
        owners: [
          { kind: "family_member", familyMemberId: clientFmId, percent: 0.5 },
          { kind: "family_member", familyMemberId: spouseFmId!, percent: 0.4 },
        ],
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/sum.*100/i);
  });

  it("3. POST with duplicate family_member owner → 400", async () => {
    const { clientId, clientFmId } = await setupClient();

    const res = await POST(
      makePostReq(clientId, {
        name: "Duplicate Owner Account",
        category: "taxable",
        subType: "brokerage",
        owner: "client",
        owners: [
          { kind: "family_member", familyMemberId: clientFmId, percent: 0.5 },
          { kind: "family_member", familyMemberId: clientFmId, percent: 0.5 },
        ],
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/duplicate/i);
  });

  it("4. POST IRA with 2 owners → 400 matching /retirement.*single owner/i", async () => {
    const { clientId, clientFmId, spouseFmId } = await setupClient();

    const res = await POST(
      makePostReq(clientId, {
        name: "Joint IRA",
        category: "retirement",
        subType: "traditional_ira",
        owner: "client",
        owners: [
          { kind: "family_member", familyMemberId: clientFmId, percent: 0.5 },
          { kind: "family_member", familyMemberId: spouseFmId!, percent: 0.5 },
        ],
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/retirement.*single owner/i);
  });

  it("5. POST without owners (legacy owner='joint' + spouse) → 201 + two 50/50 rows", async () => {
    const { clientId } = await setupClient({ withSpouse: true });

    const res = await POST(
      makePostReq(clientId, {
        name: "Joint Legacy",
        category: "taxable",
        subType: "brokerage",
        owner: "joint",
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    const { db } = dbMod;
    const { accountOwners } = schema;
    const rows = await db
      .select()
      .from(accountOwners)
      .where(drizzleOrm.eq(accountOwners.accountId, body.id));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(parseFloat(row.percent)).toBeCloseTo(0.5, 4);
    }
  });

  it("6. PUT with new valid owners[2] → 200, old rows replaced", async () => {
    const { clientId, clientFmId, spouseFmId } = await setupClient();

    // First, create an account (with legacy owner so it gets 1 owner row)
    const postRes = await POST(
      makePostReq(clientId, {
        name: "Updatable Account",
        category: "taxable",
        subType: "brokerage",
        owner: "client",
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(postRes.status).toBe(201);
    const { id: accountId } = await postRes.json();

    // PUT with 2 new owners
    const putRes = await PUT(
      makePutReq(clientId, accountId, {
        name: "Updatable Account",
        owners: [
          { kind: "family_member", familyMemberId: clientFmId, percent: 0.6 },
          { kind: "family_member", familyMemberId: spouseFmId!, percent: 0.4 },
        ],
      }) as never,
      { params: Promise.resolve({ id: clientId, accountId }) },
    );

    expect(putRes.status).toBe(200);
    const { db } = dbMod;
    const { accountOwners } = schema;
    const rows = await db
      .select()
      .from(accountOwners)
      .where(drizzleOrm.eq(accountOwners.accountId, accountId));
    expect(rows).toHaveLength(2);
    const percents = rows.map((r) => parseFloat(r.percent)).sort();
    expect(percents[0]).toBeCloseTo(0.4, 4);
    expect(percents[1]).toBeCloseTo(0.6, 4);
  });

  it("7. PUT without owners in body → 200, account_owners untouched", async () => {
    const { clientId, clientFmId } = await setupClient();

    // Create account with explicit single owner
    const postRes = await POST(
      makePostReq(clientId, {
        name: "Stable Owners Account",
        category: "taxable",
        subType: "brokerage",
        owner: "client",
        owners: [{ kind: "family_member", familyMemberId: clientFmId, percent: 1.0 }],
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(postRes.status).toBe(201);
    const { id: accountId } = await postRes.json();

    // PUT with no owners field — only update name
    const putRes = await PUT(
      makePutReq(clientId, accountId, { name: "Renamed Account" }) as never,
      { params: Promise.resolve({ id: clientId, accountId }) },
    );

    expect(putRes.status).toBe(200);

    // owner rows must be unchanged
    const { db } = dbMod;
    const { accountOwners } = schema;
    const rows = await db
      .select()
      .from(accountOwners)
      .where(drizzleOrm.eq(accountOwners.accountId, accountId));
    expect(rows).toHaveLength(1);
    expect(parseFloat(rows[0].percent)).toBeCloseTo(1.0, 4);
    expect(rows[0].familyMemberId).toBe(clientFmId);
  });

  it("8. PUT IRA with 2 owners → 400", async () => {
    const { clientId, clientFmId, spouseFmId } = await setupClient();

    // Create a valid IRA with 1 owner
    const postRes = await POST(
      makePostReq(clientId, {
        name: "Client IRA",
        category: "retirement",
        subType: "traditional_ira",
        owner: "client",
        owners: [{ kind: "family_member", familyMemberId: clientFmId, percent: 1.0 }],
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(postRes.status).toBe(201);
    const { id: accountId } = await postRes.json();

    // Try to PUT 2 owners onto an IRA
    const putRes = await PUT(
      makePutReq(clientId, accountId, {
        owners: [
          { kind: "family_member", familyMemberId: clientFmId, percent: 0.5 },
          { kind: "family_member", familyMemberId: spouseFmId!, percent: 0.5 },
        ],
      }) as never,
      { params: Promise.resolve({ id: clientId, accountId }) },
    );

    expect(putRes.status).toBe(400);
    const body = await putRes.json();
    expect(body.error).toMatch(/retirement.*single owner/i);
  });
});
