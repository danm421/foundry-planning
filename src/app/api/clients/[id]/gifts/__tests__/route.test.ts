/**
 * Integration tests for POST /api/clients/[id]/gifts,
 * PATCH /api/clients/[id]/gifts/[giftId], and
 * DELETE /api/clients/[id]/gifts/[giftId].
 * Exercises real DB via Drizzle. Requires DATABASE_URL — suite is skipped
 * in CI if unavailable.
 *
 * Covers:
 *  POST
 *  1. Cash gift creation — amount set, accountId/liabilityId null.
 *  2. Asset transfer with linked liability — parent gift + auto-bundled child gift.
 *  3. Asset transfer without linked liability — no child gift row created.
 *
 *  PATCH
 *  4. Updating percent on a parent gift propagates to bundled child gift.
 *  5. Updating percent on a child gift (parentGiftId IS NOT NULL) does NOT propagate.
 *
 *  DELETE
 *  6. Deleting a parent gift cascades to child gifts (ON DELETE CASCADE).
 *
 *  T16 — Past-dated dual-write to junction tables
 *  7. Past-dated asset transfer (year < projectionStartYear) updates account_owners.
 *  8. Future-dated asset transfer (year >= projectionStartYear) leaves account_owners unchanged.
 *  9. Past-dated asset transfer with linked liability updates both account_owners AND liability_owners.
 * 10. Drained-household guard — returns 500 when household owns 0 and transfer is attempted.
 * 11. Mid-stream household scaling — proportional preservation with client + spouse.
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

d("PATCH /api/clients/[id]/gifts/[giftId]", () => {
  let dbMod: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let helpers: typeof import("@/lib/db-helpers");
  let drizzleOrm: typeof import("drizzle-orm");
  let POST: (typeof import("../route"))["POST"];
  let PATCH: (typeof import("../[giftId]/route"))["PATCH"];

  beforeAll(async () => {
    dbMod = await import("@/db");
    schema = await import("@/db/schema");
    helpers = await import("@/lib/db-helpers");
    drizzleOrm = await import("drizzle-orm");
    ({ POST } = await import("../route"));
    ({ PATCH } = await import("../[giftId]/route"));
  });

  async function cleanup() {
    const { db } = dbMod;
    const { clients, scenarios, familyMembers, entities } = schema;

    const testClients = await db
      .select({ id: clients.id })
      .from(clients)
      .where(drizzleOrm.eq(clients.firmId, TEST_FIRM));
    const ids = testClients.map((c) => c.id);
    if (ids.length === 0) return;

    await db.delete(schema.gifts).where(drizzleOrm.inArray(schema.gifts.clientId, ids));
    await db.delete(entities).where(drizzleOrm.inArray(entities.clientId, ids));
    await db.delete(scenarios).where(drizzleOrm.inArray(scenarios.clientId, ids));
    await db.delete(familyMembers).where(drizzleOrm.inArray(familyMembers.clientId, ids));
    await db.delete(clients).where(drizzleOrm.eq(clients.firmId, TEST_FIRM));
  }

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

  function makePatchReq(clientId: string, giftId: string, body: object): Request {
    return new Request(
      `http://localhost/api/clients/${clientId}/gifts/${giftId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }

  beforeEach(async () => {
    await cleanup();
    vi.mocked(helpers.getOrgId).mockResolvedValue(TEST_FIRM);
  });

  it("4. PATCH percent on parent propagates to bundled child gift", async () => {
    const { clientId, scenarioId, entityId } = await setupClient();
    const { db } = dbMod;
    const { accounts, liabilities, gifts } = schema;

    // Seed real-estate account + linked liability
    const [account] = await db
      .insert(accounts)
      .values({
        clientId,
        scenarioId,
        name: "Rental Property",
        category: "real_estate" as const,
        subType: "rental_property",
        value: "500000",
        basis: "200000",
      })
      .returning();

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

    // POST to create parent + child gift (percent=0.5)
    const postRes = await POST(
      makePostReq(clientId, {
        year: 2026,
        grantor: "client",
        recipientEntityId: entityId,
        accountId: account.id,
        percent: 0.5,
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(postRes.status).toBe(201);
    const parentRow = await postRes.json();
    expect(parentRow.parentGiftId).toBeNull();

    // Confirm child exists with percent 0.5
    const childrenBefore = await db
      .select()
      .from(gifts)
      .where(drizzleOrm.eq(gifts.parentGiftId, parentRow.id));
    expect(childrenBefore).toHaveLength(1);
    expect(childrenBefore[0].liabilityId).toBe(liability.id);
    expect(parseFloat(childrenBefore[0].percent!)).toBeCloseTo(0.5, 4);

    // PATCH parent percent to 0.75
    const patchRes = await PATCH(
      makePatchReq(clientId, parentRow.id, { percent: 0.75 }) as never,
      { params: Promise.resolve({ id: clientId, giftId: parentRow.id }) },
    );
    expect(patchRes.status).toBe(200);
    const patchedParent = await patchRes.json();
    expect(parseFloat(patchedParent.percent)).toBeCloseTo(0.75, 4);

    // Child percent must also be 0.75
    const childrenAfter = await db
      .select()
      .from(gifts)
      .where(drizzleOrm.eq(gifts.parentGiftId, parentRow.id));
    expect(childrenAfter).toHaveLength(1);
    expect(parseFloat(childrenAfter[0].percent!)).toBeCloseTo(0.75, 4);
  });

  it("5. PATCH percent on child gift (parentGiftId set) does NOT propagate further", async () => {
    const { clientId, scenarioId, entityId } = await setupClient();
    const { db } = dbMod;
    const { accounts, liabilities, gifts } = schema;

    // Seed account + linked liability
    const [account] = await db
      .insert(accounts)
      .values({
        clientId,
        scenarioId,
        name: "Rental Property 2",
        category: "real_estate" as const,
        subType: "rental_property",
        value: "400000",
        basis: "150000",
      })
      .returning();

    await db
      .insert(liabilities)
      .values({
        clientId,
        scenarioId,
        name: "Rental Mortgage 2",
        balance: "200000",
        interestRate: "0.06",
        monthlyPayment: "1200",
        startYear: 2021,
        termMonths: 360,
        linkedPropertyId: account.id,
      })
      .returning();

    // Create parent + child via POST
    const postRes = await POST(
      makePostReq(clientId, {
        year: 2026,
        grantor: "client",
        recipientEntityId: entityId,
        accountId: account.id,
        percent: 0.6,
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(postRes.status).toBe(201);
    const parentRow = await postRes.json();

    const [child] = await db
      .select()
      .from(gifts)
      .where(drizzleOrm.eq(gifts.parentGiftId, parentRow.id));

    // PATCH the child directly — percent changes only on child, parent unchanged
    const patchRes = await PATCH(
      makePatchReq(clientId, child.id, { percent: 0.9 }) as never,
      { params: Promise.resolve({ id: clientId, giftId: child.id }) },
    );
    expect(patchRes.status).toBe(200);
    const patchedChild = await patchRes.json();
    expect(parseFloat(patchedChild.percent)).toBeCloseTo(0.9, 4);

    // Parent percent must be unchanged at 0.6
    const [parentAfter] = await db
      .select()
      .from(gifts)
      .where(drizzleOrm.eq(gifts.id, parentRow.id));
    expect(parseFloat(parentAfter.percent!)).toBeCloseTo(0.6, 4);
  });
});

d("DELETE /api/clients/[id]/gifts/[giftId]", () => {
  let dbMod: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let helpers: typeof import("@/lib/db-helpers");
  let drizzleOrm: typeof import("drizzle-orm");
  let POST: (typeof import("../route"))["POST"];
  let DELETE: (typeof import("../[giftId]/route"))["DELETE"];

  beforeAll(async () => {
    dbMod = await import("@/db");
    schema = await import("@/db/schema");
    helpers = await import("@/lib/db-helpers");
    drizzleOrm = await import("drizzle-orm");
    ({ POST } = await import("../route"));
    ({ DELETE } = await import("../[giftId]/route"));
  });

  async function cleanup() {
    const { db } = dbMod;
    const { clients, scenarios, familyMembers, entities } = schema;

    const testClients = await db
      .select({ id: clients.id })
      .from(clients)
      .where(drizzleOrm.eq(clients.firmId, TEST_FIRM));
    const ids = testClients.map((c) => c.id);
    if (ids.length === 0) return;

    await db.delete(schema.gifts).where(drizzleOrm.inArray(schema.gifts.clientId, ids));
    await db.delete(entities).where(drizzleOrm.inArray(entities.clientId, ids));
    await db.delete(scenarios).where(drizzleOrm.inArray(scenarios.clientId, ids));
    await db.delete(familyMembers).where(drizzleOrm.inArray(familyMembers.clientId, ids));
    await db.delete(clients).where(drizzleOrm.eq(clients.firmId, TEST_FIRM));
  }

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

  function makeDeleteReq(clientId: string, giftId: string): Request {
    return new Request(
      `http://localhost/api/clients/${clientId}/gifts/${giftId}`,
      { method: "DELETE" },
    );
  }

  beforeEach(async () => {
    await cleanup();
    vi.mocked(helpers.getOrgId).mockResolvedValue(TEST_FIRM);
  });

  it("6. DELETE parent gift cascades — child gift is removed", async () => {
    const { clientId, scenarioId, entityId } = await setupClient();
    const { db } = dbMod;
    const { accounts, liabilities, gifts } = schema;

    // Seed account + linked liability
    const [account] = await db
      .insert(accounts)
      .values({
        clientId,
        scenarioId,
        name: "Rental Property",
        category: "real_estate" as const,
        subType: "rental_property",
        value: "600000",
        basis: "300000",
      })
      .returning();

    await db
      .insert(liabilities)
      .values({
        clientId,
        scenarioId,
        name: "Rental Mortgage",
        balance: "300000",
        interestRate: "0.07",
        monthlyPayment: "2000",
        startYear: 2019,
        termMonths: 360,
        linkedPropertyId: account.id,
      })
      .returning();

    // Create parent + child via POST
    const postRes = await POST(
      makePostReq(clientId, {
        year: 2026,
        grantor: "client",
        recipientEntityId: entityId,
        accountId: account.id,
        percent: 0.5,
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(postRes.status).toBe(201);
    const parentRow = await postRes.json();

    // Confirm child exists
    const childrenBefore = await db
      .select()
      .from(gifts)
      .where(drizzleOrm.eq(gifts.parentGiftId, parentRow.id));
    expect(childrenBefore).toHaveLength(1);

    // DELETE the parent
    const deleteRes = await DELETE(
      makeDeleteReq(clientId, parentRow.id) as never,
      { params: Promise.resolve({ id: clientId, giftId: parentRow.id }) },
    );
    expect(deleteRes.status).toBe(200);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.ok).toBe(true);

    // Child must have cascaded away
    const childrenAfter = await db
      .select()
      .from(gifts)
      .where(drizzleOrm.eq(gifts.parentGiftId, parentRow.id));
    expect(childrenAfter).toHaveLength(0);

    // Parent row must also be gone
    const parentAfter = await db
      .select()
      .from(gifts)
      .where(drizzleOrm.eq(gifts.id, parentRow.id));
    expect(parentAfter).toHaveLength(0);
  });
});

// ── T16: Past-dated dual-write to junction tables ─────────────────────────────

d("POST /api/clients/[id]/gifts — T16 past-dated dual-write", () => {
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

  async function cleanup() {
    const { db } = dbMod;
    const { clients, scenarios, familyMembers, entities } = schema;
    const { sql } = drizzleOrm;

    const testClients = await db
      .select({ id: clients.id })
      .from(clients)
      .where(drizzleOrm.eq(clients.firmId, TEST_FIRM));
    const ids = testClients.map((c) => c.id);
    if (ids.length === 0) return;

    // The account_owners / liability_owners sum-check triggers fire at commit and raise if
    // any row is deleted while its parent account/liability still exists with zero remaining
    // owners. Disable them for the cleanup transaction, then re-enable. Mirrors the pattern
    // in src/app/api/clients/[id]/accounts/__tests__/owners.test.ts.
    await db.execute(sql`ALTER TABLE account_owners DISABLE TRIGGER account_owners_sum_check`);
    await db.execute(sql`ALTER TABLE account_owners DISABLE TRIGGER account_owners_retirement_check`);
    await db.execute(sql`ALTER TABLE account_owners DISABLE TRIGGER account_owners_default_checking_check`);
    await db.execute(sql`ALTER TABLE liability_owners DISABLE TRIGGER liability_owners_sum_check`);
    try {
      // gifts.account_id has ON DELETE SET NULL — delete gifts first to avoid the
      // gifts_event_kind check constraint firing when accounts are cascade-deleted.
      await db.delete(schema.gifts).where(drizzleOrm.inArray(schema.gifts.clientId, ids));
      // Deleting clients cascades to accounts → account_owners, liabilities → liability_owners,
      // scenarios → plan_settings, entities, family_members automatically.
      await db.delete(entities).where(drizzleOrm.inArray(entities.clientId, ids));
      await db.delete(scenarios).where(drizzleOrm.inArray(scenarios.clientId, ids));
      await db.delete(familyMembers).where(drizzleOrm.inArray(familyMembers.clientId, ids));
      await db.delete(clients).where(drizzleOrm.eq(clients.firmId, TEST_FIRM));
    } finally {
      await db.execute(sql`ALTER TABLE account_owners ENABLE TRIGGER account_owners_sum_check`);
      await db.execute(sql`ALTER TABLE account_owners ENABLE TRIGGER account_owners_retirement_check`);
      await db.execute(sql`ALTER TABLE account_owners ENABLE TRIGGER account_owners_default_checking_check`);
      await db.execute(sql`ALTER TABLE liability_owners ENABLE TRIGGER liability_owners_sum_check`);
    }
  }

  /**
   * Sets up a client + scenario + plan_settings (planStartYear = 2026) + two
   * family members (client + spouse) + one irrevocable trust entity.
   * Returns IDs needed by tests.
   */
  async function setupClientWithPlanSettings(planStartYear = 2026) {
    const { db } = dbMod;
    const { clients, scenarios, familyMembers, entities } = schema;

    const [client] = await db
      .insert(clients)
      .values({
        firmId: TEST_FIRM,
        advisorId: "advisor_t16_test",
        firstName: "T16",
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

    await db.insert(schema.planSettings).values({
      clientId: client.id,
      scenarioId: scenario.id,
      planStartYear,
      planEndYear: planStartYear + 30,
    });

    const [clientFm] = await db
      .insert(familyMembers)
      .values({
        clientId: client.id,
        firstName: "T16Client",
        lastName: "Test",
        role: "client" as const,
      })
      .returning();

    const [spouseFm] = await db
      .insert(familyMembers)
      .values({
        clientId: client.id,
        firstName: "T16Spouse",
        lastName: "Test",
        role: "spouse" as const,
      })
      .returning();

    const [entity] = await db
      .insert(entities)
      .values({
        clientId: client.id,
        name: "T16 Trust",
        entityType: "trust" as const,
        isIrrevocable: true,
      })
      .returning();

    return {
      clientId: client.id,
      scenarioId: scenario.id,
      clientFmId: clientFm.id,
      spouseFmId: spouseFm.id,
      entityId: entity.id,
    };
  }

  /**
   * Seeds a brokerage account with client 100% ownership + account_owners row.
   */
  async function setupAccountWithOwner(
    clientId: string,
    scenarioId: string,
    clientFmId: string,
  ) {
    const { db } = dbMod;
    const [account] = await db
      .insert(schema.accounts)
      .values({
        clientId,
        scenarioId,
        name: "T16 Brokerage",
        category: "taxable" as const,
        subType: "brokerage",
        value: "100000",
        basis: "80000",
      })
      .returning();
    await db.insert(schema.accountOwners).values({
      accountId: account.id,
      familyMemberId: clientFmId,
      entityId: null,
      percent: "1.0000",
    });
    return account;
  }

  /**
   * Seeds a real-estate account with joint (client 60%, spouse 40%) ownership + liability.
   */
  async function setupRealEstateWithJointOwners(
    clientId: string,
    scenarioId: string,
    clientFmId: string,
    spouseFmId: string,
  ) {
    const { db } = dbMod;
    const [account] = await db
      .insert(schema.accounts)
      .values({
        clientId,
        scenarioId,
        name: "T16 Real Estate",
        category: "real_estate" as const,
        subType: "rental_property",
        value: "500000",
        basis: "200000",
      })
      .returning();
    await db.insert(schema.accountOwners).values([
      { accountId: account.id, familyMemberId: clientFmId, entityId: null, percent: "0.6000" },
      { accountId: account.id, familyMemberId: spouseFmId, entityId: null, percent: "0.4000" },
    ]);

    const [liability] = await db
      .insert(schema.liabilities)
      .values({
        clientId,
        scenarioId,
        name: "T16 Mortgage",
        balance: "250000",
        interestRate: "0.065",
        monthlyPayment: "1500",
        startYear: 2020,
        termMonths: 360,
        linkedPropertyId: account.id,
      })
      .returning();
    await db.insert(schema.liabilityOwners).values([
      { liabilityId: liability.id, familyMemberId: clientFmId, entityId: null, percent: "0.6000" },
      { liabilityId: liability.id, familyMemberId: spouseFmId, entityId: null, percent: "0.4000" },
    ]);

    return { account, liability };
  }

  function makePostReq(clientId: string, body: object): Request {
    return new Request(`http://localhost/api/clients/${clientId}/gifts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(async () => {
    await cleanup();
    vi.mocked(helpers.getOrgId).mockResolvedValue(TEST_FIRM);
  });

  it("7. Past-dated asset transfer (year < projectionStartYear) updates account_owners", async () => {
    const { clientId, scenarioId, clientFmId, entityId } = await setupClientWithPlanSettings(2026);
    const { db } = dbMod;
    const account = await setupAccountWithOwner(clientId, scenarioId, clientFmId);

    const res = await POST(
      makePostReq(clientId, {
        year: 2024,
        grantor: "client",
        recipientEntityId: entityId,
        accountId: account.id,
        percent: 0.5,
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(res.status).toBe(201);

    const owners = await db
      .select()
      .from(schema.accountOwners)
      .where(drizzleOrm.eq(schema.accountOwners.accountId, account.id));

    // Should have 2 rows: client 50% + trust 50%
    expect(owners).toHaveLength(2);
    const total = owners.reduce((s, o) => s + Number(o.percent), 0);
    expect(total).toBeCloseTo(1.0, 4);

    const trustRow = owners.find((o) => o.entityId === entityId);
    expect(trustRow).toBeDefined();
    expect(Number(trustRow!.percent)).toBeCloseTo(0.5, 4);

    const clientRow = owners.find((o) => o.familyMemberId === clientFmId);
    expect(clientRow).toBeDefined();
    expect(Number(clientRow!.percent)).toBeCloseTo(0.5, 4);
  });

  it("8. Future-dated asset transfer (year >= projectionStartYear) leaves account_owners unchanged", async () => {
    const { clientId, scenarioId, clientFmId, entityId } = await setupClientWithPlanSettings(2026);
    const { db } = dbMod;
    const account = await setupAccountWithOwner(clientId, scenarioId, clientFmId);

    const res = await POST(
      makePostReq(clientId, {
        year: 2030,
        grantor: "client",
        recipientEntityId: entityId,
        accountId: account.id,
        percent: 0.5,
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(res.status).toBe(201);

    const owners = await db
      .select()
      .from(schema.accountOwners)
      .where(drizzleOrm.eq(schema.accountOwners.accountId, account.id));

    // account_owners unchanged — still 1 row: client 100%
    expect(owners).toHaveLength(1);
    expect(owners[0].familyMemberId).toBe(clientFmId);
    expect(Number(owners[0].percent)).toBeCloseTo(1.0, 4);
    expect(owners[0].entityId).toBeNull();
  });

  it("9. Past-dated asset transfer with linked liability updates both account_owners AND liability_owners", async () => {
    const { clientId, scenarioId, clientFmId, spouseFmId, entityId } =
      await setupClientWithPlanSettings(2026);
    const { db } = dbMod;
    const { account, liability } = await setupRealEstateWithJointOwners(
      clientId,
      scenarioId,
      clientFmId,
      spouseFmId,
    );

    const res = await POST(
      makePostReq(clientId, {
        year: 2023,
        grantor: "client",
        recipientEntityId: entityId,
        accountId: account.id,
        percent: 0.5,
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(res.status).toBe(201);

    // account_owners: trust 50%, client+spouse share the remaining 50% proportionally
    const acctOwners = await db
      .select()
      .from(schema.accountOwners)
      .where(drizzleOrm.eq(schema.accountOwners.accountId, account.id));
    expect(acctOwners).toHaveLength(3); // trust + client + spouse
    const acctTotal = acctOwners.reduce((s, o) => s + Number(o.percent), 0);
    expect(acctTotal).toBeCloseTo(1.0, 4);
    const acctTrust = acctOwners.find((o) => o.entityId === entityId);
    expect(Number(acctTrust!.percent)).toBeCloseTo(0.5, 4);
    // client was 60% of 100%; now 60% of 50% = 0.30
    const acctClient = acctOwners.find((o) => o.familyMemberId === clientFmId);
    expect(Number(acctClient!.percent)).toBeCloseTo(0.3, 4);
    // spouse was 40% of 100%; now 40% of 50% = 0.20
    const acctSpouse = acctOwners.find((o) => o.familyMemberId === spouseFmId);
    expect(Number(acctSpouse!.percent)).toBeCloseTo(0.2, 4);

    // liability_owners: same proportions
    const liabOwners = await db
      .select()
      .from(schema.liabilityOwners)
      .where(drizzleOrm.eq(schema.liabilityOwners.liabilityId, liability.id));
    expect(liabOwners).toHaveLength(3);
    const liabTotal = liabOwners.reduce((s, o) => s + Number(o.percent), 0);
    expect(liabTotal).toBeCloseTo(1.0, 4);
    const liabTrust = liabOwners.find((o) => o.entityId === entityId);
    expect(Number(liabTrust!.percent)).toBeCloseTo(0.5, 4);
    const liabClient = liabOwners.find((o) => o.familyMemberId === clientFmId);
    expect(Number(liabClient!.percent)).toBeCloseTo(0.3, 4);
    const liabSpouse = liabOwners.find((o) => o.familyMemberId === spouseFmId);
    expect(Number(liabSpouse!.percent)).toBeCloseTo(0.2, 4);
  });

  it("10. Drained-household guard — returns 400 with descriptive message when household owns 0%", async () => {
    const { clientId, scenarioId, clientFmId, entityId } = await setupClientWithPlanSettings(2026);
    const account = await setupAccountWithOwner(clientId, scenarioId, clientFmId);

    // Transfer all 100% to trust first (past-dated)
    const res1 = await POST(
      makePostReq(clientId, {
        year: 2024,
        grantor: "client",
        recipientEntityId: entityId,
        accountId: account.id,
        percent: 1.0,
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(res1.status).toBe(201);

    // Now try to transfer another 50% — household is drained.
    // Tagged OwnershipTransferError → caller gets 400, not 500.
    const res2 = await POST(
      makePostReq(clientId, {
        year: 2024,
        grantor: "client",
        recipientEntityId: entityId,
        accountId: account.id,
        percent: 0.5,
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(res2.status).toBe(400);
    const body = (await res2.json()) as { error: string };
    expect(body.error).toMatch(/household.*remaining share/i);
  });

  it("11. Mid-stream household scaling — proportional preservation (client 60%, spouse 40%, transfer 50%)", async () => {
    const { clientId, scenarioId, clientFmId, spouseFmId, entityId } =
      await setupClientWithPlanSettings(2026);
    const { db } = dbMod;
    // Seed a brokerage account with client 60% / spouse 40%
    const [account] = await db
      .insert(schema.accounts)
      .values({
        clientId,
        scenarioId,
        name: "T16 Joint Brokerage",
        category: "taxable" as const,
        subType: "brokerage",
        value: "200000",
        basis: "100000",
      })
      .returning();
    await db.insert(schema.accountOwners).values([
      { accountId: account.id, familyMemberId: clientFmId, entityId: null, percent: "0.6000" },
      { accountId: account.id, familyMemberId: spouseFmId, entityId: null, percent: "0.4000" },
    ]);

    const res = await POST(
      makePostReq(clientId, {
        year: 2025,
        grantor: "client",
        recipientEntityId: entityId,
        accountId: account.id,
        percent: 0.5,
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(res.status).toBe(201);

    const owners = await db
      .select()
      .from(schema.accountOwners)
      .where(drizzleOrm.eq(schema.accountOwners.accountId, account.id));
    expect(owners).toHaveLength(3);
    const total = owners.reduce((s, o) => s + Number(o.percent), 0);
    expect(total).toBeCloseTo(1.0, 4);

    // trust: 50%
    const trustRow = owners.find((o) => o.entityId === entityId);
    expect(Number(trustRow!.percent)).toBeCloseTo(0.5, 4);

    // client: 60% of (1 - 0.5) = 0.30
    const clientRow = owners.find((o) => o.familyMemberId === clientFmId);
    expect(Number(clientRow!.percent)).toBeCloseTo(0.3, 4);

    // spouse: 40% of (1 - 0.5) = 0.20
    const spouseRow = owners.find((o) => o.familyMemberId === spouseFmId);
    expect(Number(spouseRow!.percent)).toBeCloseTo(0.2, 4);
  });
});
