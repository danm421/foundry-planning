/**
 * Integration tests for liability owners[] payload: POST and PUT.
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

vi.mock("@/lib/audit/snapshots/liability", () => ({
  toLiabilitySnapshot: vi.fn().mockResolvedValue({}),
  LIABILITY_FIELD_LABELS: {},
}));

// db-scoping: passthrough for these tests (ownership FK validation handles tenant isolation)
vi.mock("@/lib/db-scoping", () => ({
  assertEntitiesInClient: vi.fn().mockResolvedValue({ ok: true }),
  assertAccountsInClient: vi.fn().mockResolvedValue({ ok: true }),
}));

const TEST_FIRM = "firm_liability_owners_test";

d("Liability owners[] API — POST and PUT", () => {
  let dbMod: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let helpers: typeof import("@/lib/db-helpers");
  let drizzleOrm: typeof import("drizzle-orm");

  let POST: (typeof import("../route"))["POST"];
  let PUT: (typeof import("../[liabilityId]/route"))["PUT"];

  beforeAll(async () => {
    dbMod = await import("@/db");
    schema = await import("@/db/schema");
    helpers = await import("@/lib/db-helpers");
    drizzleOrm = await import("drizzle-orm");
    ({ POST } = await import("../route"));
    ({ PUT } = await import("../[liabilityId]/route"));
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

    // Disable the sum-check trigger for cleanup so cascade deletes don't trip the invariant.
    await db.execute(sql`ALTER TABLE liability_owners DISABLE TRIGGER liability_owners_sum_check`);
    try {
      // Deleting clients cascades to liabilities → liability_owners automatically.
      await db.delete(entities).where(inArray(entities.clientId, ids));
      await db.delete(scenarios).where(inArray(scenarios.clientId, ids));
      await db.delete(familyMembers).where(inArray(familyMembers.clientId, ids));
      await db.delete(clients).where(drizzleOrm.eq(clients.firmId, TEST_FIRM));
    } finally {
      await db.execute(sql`ALTER TABLE liability_owners ENABLE TRIGGER liability_owners_sum_check`);
    }
  }

  /**
   * Seeds a firm + client + scenario + client family member +
   * optional spouse + optional entity. Returns all seeded IDs.
   */
  async function setupClient(opts?: { withSpouse?: boolean; withEntity?: boolean }) {
    const { db } = dbMod;
    const { clients, scenarios, familyMembers, entities } = schema;

    const [client] = await db
      .insert(clients)
      .values({
        firmId: TEST_FIRM,
        advisorId: "advisor_liability_owners_test",
        firstName: "LiabOwners",
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

    const [clientFm] = await db
      .insert(familyMembers)
      .values({
        clientId: client.id,
        firstName: "LiabOwners",
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
    return new Request(`http://localhost/api/clients/${clientId}/liabilities`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function makePutReq(clientId: string, liabilityId: string, body: object): Request {
    return new Request(
      `http://localhost/api/clients/${clientId}/liabilities/${liabilityId}`,
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

  it("1. POST with valid owners[3] summing to 100% (FM + FM + entity) → 201 + 3 liability_owners rows", async () => {
    const { clientId, clientFmId, spouseFmId, entityId } = await setupClient({ withEntity: true });

    const res = await POST(
      makePostReq(clientId, {
        name: "Three Owner Mortgage",
        startYear: 2024,
        termMonths: 360,
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
    const { liabilityOwners } = schema;
    const rows = await db
      .select()
      .from(liabilityOwners)
      .where(drizzleOrm.eq(liabilityOwners.liabilityId, body.id));
    expect(rows).toHaveLength(3);
  });

  it("2. POST with owners summing to 90% → 400 matching /sum.*100/i", async () => {
    const { clientId, clientFmId, spouseFmId } = await setupClient();

    const res = await POST(
      makePostReq(clientId, {
        name: "Bad Sum Mortgage",
        startYear: 2024,
        termMonths: 360,
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

  it("3. POST with duplicate family_member owner → 400 matching /duplicate/i", async () => {
    const { clientId, clientFmId } = await setupClient();

    const res = await POST(
      makePostReq(clientId, {
        name: "Duplicate Owner Mortgage",
        startYear: 2024,
        termMonths: 360,
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

  it("4. POST without owners (legacy ownerEntityId set) → 201 + 1 liability_owners row (entity 100%)", async () => {
    const { clientId, entityId } = await setupClient({ withEntity: true });

    const res = await POST(
      makePostReq(clientId, {
        name: "Entity Owned Mortgage",
        startYear: 2024,
        termMonths: 360,
        ownerEntityId: entityId,
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    const { db } = dbMod;
    const { liabilityOwners } = schema;
    const rows = await db
      .select()
      .from(liabilityOwners)
      .where(drizzleOrm.eq(liabilityOwners.liabilityId, body.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].entityId).toBe(entityId);
    expect(parseFloat(rows[0].percent)).toBeCloseTo(1.0, 4);
  });

  it("5. POST without owners (no ownerEntityId) → 201 + 1 liability_owners row (client family_member 100%)", async () => {
    const { clientId, clientFmId } = await setupClient();

    const res = await POST(
      makePostReq(clientId, {
        name: "Client Owned Mortgage",
        startYear: 2024,
        termMonths: 360,
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    const { db } = dbMod;
    const { liabilityOwners } = schema;
    const rows = await db
      .select()
      .from(liabilityOwners)
      .where(drizzleOrm.eq(liabilityOwners.liabilityId, body.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].familyMemberId).toBe(clientFmId);
    expect(parseFloat(rows[0].percent)).toBeCloseTo(1.0, 4);
  });

  it("6. PUT with new valid owners[2] → 200, old rows replaced", async () => {
    const { clientId, clientFmId, spouseFmId } = await setupClient();

    // Create a liability (legacy — no owners[] in body — gets 1 owner row)
    const postRes = await POST(
      makePostReq(clientId, {
        name: "Updatable Mortgage",
        startYear: 2024,
        termMonths: 360,
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(postRes.status).toBe(201);
    const { id: liabilityId } = await postRes.json();

    // PUT with 2 new owners
    const putRes = await PUT(
      makePutReq(clientId, liabilityId, {
        name: "Updatable Mortgage",
        owners: [
          { kind: "family_member", familyMemberId: clientFmId, percent: 0.6 },
          { kind: "family_member", familyMemberId: spouseFmId!, percent: 0.4 },
        ],
      }) as never,
      { params: Promise.resolve({ id: clientId, liabilityId }) },
    );

    expect(putRes.status).toBe(200);
    const { db } = dbMod;
    const { liabilityOwners } = schema;
    const rows = await db
      .select()
      .from(liabilityOwners)
      .where(drizzleOrm.eq(liabilityOwners.liabilityId, liabilityId));
    expect(rows).toHaveLength(2);
    const percents = rows.map((r) => parseFloat(r.percent)).sort();
    expect(percents[0]).toBeCloseTo(0.4, 4);
    expect(percents[1]).toBeCloseTo(0.6, 4);
  });

  it("7. PUT without owners in body → 200, liability_owners untouched", async () => {
    const { clientId, clientFmId } = await setupClient();

    // Create liability with explicit single owner
    const postRes = await POST(
      makePostReq(clientId, {
        name: "Stable Owners Mortgage",
        startYear: 2024,
        termMonths: 360,
        owners: [{ kind: "family_member", familyMemberId: clientFmId, percent: 1.0 }],
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(postRes.status).toBe(201);
    const { id: liabilityId } = await postRes.json();

    // PUT with no owners field — only update name
    const putRes = await PUT(
      makePutReq(clientId, liabilityId, { name: "Renamed Mortgage" }) as never,
      { params: Promise.resolve({ id: clientId, liabilityId }) },
    );

    expect(putRes.status).toBe(200);

    const { db } = dbMod;
    const { liabilityOwners } = schema;
    const rows = await db
      .select()
      .from(liabilityOwners)
      .where(drizzleOrm.eq(liabilityOwners.liabilityId, liabilityId));
    expect(rows).toHaveLength(1);
    expect(parseFloat(rows[0].percent)).toBeCloseTo(1.0, 4);
    expect(rows[0].familyMemberId).toBe(clientFmId);
  });
});
