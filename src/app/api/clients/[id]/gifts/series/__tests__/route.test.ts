/**
 * Integration tests for:
 *   GET  /api/clients/[id]/gifts/series
 *   POST /api/clients/[id]/gifts/series
 *   PATCH  /api/clients/[id]/gifts/series/[seriesId]
 *   DELETE /api/clients/[id]/gifts/series/[seriesId]
 *
 * Exercises the real DB via Drizzle.  Requires DATABASE_URL — suite is skipped
 * in CI if unavailable.
 *
 * Covers:
 *   1. POST creates a single gift_series row with all new fields.
 *   2. GET returns persisted series rows.
 *   3. PATCH /[seriesId] updates a row.
 *   4. DELETE /[seriesId] removes a row.
 *   5. POST rejects endYear < startYear with 400.
 *   6. POST rejects revocable trust as recipient with 400.
 *   7. PATCH on a series owned by a different client returns 404.
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

vi.mock("@/lib/audit", () => ({
  recordCreate: vi.fn().mockResolvedValue(undefined),
  recordUpdate: vi.fn().mockResolvedValue(undefined),
  recordDelete: vi.fn().mockResolvedValue(undefined),
}));

const TEST_FIRM = "firm_gift_series_route_test";

d("gift_series CRUD", () => {
  let dbMod: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let helpers: typeof import("@/lib/db-helpers");
  let drizzleOrm: typeof import("drizzle-orm");
  let GET: (typeof import("../route"))["GET"];
  let POST: (typeof import("../route"))["POST"];
  let PATCH: (typeof import("../[seriesId]/route"))["PATCH"];
  let DELETE: (typeof import("../[seriesId]/route"))["DELETE"];

  beforeAll(async () => {
    dbMod = await import("@/db");
    schema = await import("@/db/schema");
    helpers = await import("@/lib/db-helpers");
    drizzleOrm = await import("drizzle-orm");
    ({ GET, POST } = await import("../route"));
    ({ PATCH, DELETE } = await import("../[seriesId]/route"));
  });

  // ── helpers ────────────────────────────────────────────────────────────────

  async function cleanup() {
    const { db } = dbMod;
    const { clients } = schema;
    // Delete clients in a single statement so cascade flows
    // accounts → account_owners atomically. Splitting deletes across
    // statements lets the deferred sum-check trigger fire between them
    // and raise on transient zero-owner state.
    await db.delete(clients).where(drizzleOrm.eq(clients.firmId, TEST_FIRM));
  }

  /**
   * Seeds a minimal client + base-case scenario + irrevocable trust entity.
   * Returns clientId, scenarioId, entityId, and a revocableEntityId.
   */
  async function setupClient() {
    const { db } = dbMod;
    const { clients, scenarios, familyMembers, entities } = schema;

    const [client] = await db
      .insert(clients)
      .values({
        firmId: TEST_FIRM,
        advisorId: "advisor_series_test",
        firstName: "Series",
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
        firstName: "Series",
        lastName: "Test",
        role: "client" as const,
      })
      .returning();

    const [irrevocableTrust] = await db
      .insert(entities)
      .values({
        clientId: client.id,
        name: "ILIT",
        entityType: "trust" as const,
        isIrrevocable: true,
      })
      .returning();

    const [revocableTrust] = await db
      .insert(entities)
      .values({
        clientId: client.id,
        name: "Revocable Living Trust",
        entityType: "trust" as const,
        isIrrevocable: false,
      })
      .returning();

    return {
      clientId: client.id,
      scenarioId: scenario.id,
      familyMemberId: fm.id,
      entityId: irrevocableTrust.id,
      revocableEntityId: revocableTrust.id,
    };
  }

  function makeGetReq(clientId: string): Request {
    return new Request(`http://localhost/api/clients/${clientId}/gifts/series`, {
      method: "GET",
    });
  }

  function makePostReq(clientId: string, body: object): Request {
    return new Request(`http://localhost/api/clients/${clientId}/gifts/series`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function makePatchReq(
    clientId: string,
    seriesId: string,
    body: object,
  ): Request {
    return new Request(
      `http://localhost/api/clients/${clientId}/gifts/series/${seriesId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }

  function makeDeleteReq(clientId: string, seriesId: string): Request {
    return new Request(
      `http://localhost/api/clients/${clientId}/gifts/series/${seriesId}`,
      { method: "DELETE" },
    );
  }

  // ── setup / teardown ───────────────────────────────────────────────────────

  beforeEach(async () => {
    await cleanup();
    vi.mocked(helpers.requireOrgId).mockResolvedValue(TEST_FIRM);
    vi.mocked(helpers.getOrgId).mockResolvedValue(TEST_FIRM);
  });

  // ── tests ──────────────────────────────────────────────────────────────────

  it("1. POST creates a gift_series row with all new fields", async () => {
    const { clientId, entityId, scenarioId } = await setupClient();
    const { db } = dbMod;
    const { giftSeries } = schema;

    const res = await POST(
      makePostReq(clientId, {
        grantor: "client",
        recipientEntityId: entityId,
        startYear: 2026,
        endYear: 2042,
        annualAmount: 19000,
        inflationAdjust: true,
        useCrummeyPowers: true,
        notes: "ILIT premium",
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTruthy();

    const [row] = await db
      .select()
      .from(giftSeries)
      .where(drizzleOrm.eq(giftSeries.id, body.id));

    expect(row).toBeDefined();
    expect(row.clientId).toBe(clientId);
    expect(row.scenarioId).toBe(scenarioId);
    expect(row.grantor).toBe("client");
    expect(row.startYear).toBe(2026);
    expect(row.endYear).toBe(2042);
    expect(parseFloat(row.annualAmount)).toBeCloseTo(19000, 2);
    expect(row.inflationAdjust).toBe(true);
    expect(row.useCrummeyPowers).toBe(true);
    expect(row.notes).toBe("ILIT premium");
  });

  it("2. GET returns persisted series rows", async () => {
    const { clientId, entityId } = await setupClient();

    // POST two rows
    const res1 = await POST(
      makePostReq(clientId, {
        grantor: "client",
        recipientEntityId: entityId,
        startYear: 2026,
        endYear: 2030,
        annualAmount: 18000,
        inflationAdjust: false,
        useCrummeyPowers: false,
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(res1.status).toBe(201);

    const res2 = await POST(
      makePostReq(clientId, {
        grantor: "spouse",
        recipientEntityId: entityId,
        startYear: 2027,
        endYear: 2035,
        annualAmount: 9000,
        inflationAdjust: true,
        useCrummeyPowers: true,
        notes: "Split-gift",
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(res2.status).toBe(201);

    const getRes = await GET(
      makeGetReq(clientId) as never,
      { params: Promise.resolve({ id: clientId }) },
    );

    expect(getRes.status).toBe(200);
    const rows = await getRes.json();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(2);

    const sorted = [...rows].sort(
      (a: { startYear: number }, b: { startYear: number }) => a.startYear - b.startYear,
    );
    expect(sorted[0].grantor).toBe("client");
    expect(sorted[0].startYear).toBe(2026);
    expect(sorted[1].grantor).toBe("spouse");
    expect(sorted[1].notes).toBe("Split-gift");
  });

  it("3. PATCH /[seriesId] updates a row", async () => {
    const { clientId, entityId } = await setupClient();
    const { db } = dbMod;
    const { giftSeries } = schema;

    const postRes = await POST(
      makePostReq(clientId, {
        grantor: "client",
        recipientEntityId: entityId,
        startYear: 2026,
        endYear: 2035,
        annualAmount: 18000,
        inflationAdjust: false,
        useCrummeyPowers: false,
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(postRes.status).toBe(201);
    const { id: seriesId } = await postRes.json();

    const patchRes = await PATCH(
      makePatchReq(clientId, seriesId, { annualAmount: 25000 }) as never,
      { params: Promise.resolve({ id: clientId, seriesId }) },
    );
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json();
    expect(parseFloat(updated.annualAmount)).toBeCloseTo(25000, 2);

    // Confirm in DB
    const [row] = await db
      .select()
      .from(giftSeries)
      .where(drizzleOrm.eq(giftSeries.id, seriesId));
    expect(parseFloat(row.annualAmount)).toBeCloseTo(25000, 2);
  });

  it("4. DELETE /[seriesId] removes a row", async () => {
    const { clientId, entityId } = await setupClient();
    const { db } = dbMod;
    const { giftSeries } = schema;

    const postRes = await POST(
      makePostReq(clientId, {
        grantor: "client",
        recipientEntityId: entityId,
        startYear: 2026,
        endYear: 2030,
        annualAmount: 18000,
        inflationAdjust: false,
        useCrummeyPowers: false,
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(postRes.status).toBe(201);
    const { id: seriesId } = await postRes.json();

    const deleteRes = await DELETE(
      makeDeleteReq(clientId, seriesId) as never,
      { params: Promise.resolve({ id: clientId, seriesId }) },
    );
    expect(deleteRes.status).toBe(200);
    const body = await deleteRes.json();
    expect(body.ok).toBe(true);

    // Row must be gone
    const rows = await db
      .select()
      .from(giftSeries)
      .where(drizzleOrm.eq(giftSeries.id, seriesId));
    expect(rows).toHaveLength(0);
  });

  it("5. POST rejects endYear < startYear with 400", async () => {
    const { clientId, entityId } = await setupClient();

    const res = await POST(
      makePostReq(clientId, {
        grantor: "client",
        recipientEntityId: entityId,
        startYear: 2030,
        endYear: 2026,
        annualAmount: 18000,
        inflationAdjust: false,
        useCrummeyPowers: false,
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
  });

  it("6. POST rejects revocable trust as recipient with 400", async () => {
    const { clientId, revocableEntityId } = await setupClient();

    const res = await POST(
      makePostReq(clientId, {
        grantor: "client",
        recipientEntityId: revocableEntityId,
        startYear: 2026,
        endYear: 2030,
        annualAmount: 18000,
        inflationAdjust: false,
        useCrummeyPowers: false,
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Recurring gifts target irrevocable trusts only");
  });

  it("7. PATCH on a series owned by a different client returns 404", async () => {
    // Set up two separate clients
    const { clientId: clientA, entityId: entityA } = await setupClient();

    // Create a second client under the same firm
    const { db } = dbMod;
    const { clients, scenarios } = schema;
    const [clientB] = await db
      .insert(clients)
      .values({
        firmId: TEST_FIRM,
        advisorId: "advisor_series_test",
        firstName: "Other",
        lastName: "Client",
        dateOfBirth: "1975-06-15",
        retirementAge: 65,
        planEndAge: 90,
        lifeExpectancy: 90,
        filingStatus: "single",
      })
      .returning();
    await db
      .insert(scenarios)
      .values({ clientId: clientB.id, name: "base", isBaseCase: true });

    // POST a series under clientA
    const postRes = await POST(
      makePostReq(clientA, {
        grantor: "client",
        recipientEntityId: entityA,
        startYear: 2026,
        endYear: 2030,
        annualAmount: 18000,
        inflationAdjust: false,
        useCrummeyPowers: false,
      }) as never,
      { params: Promise.resolve({ id: clientA }) },
    );
    expect(postRes.status).toBe(201);
    const { id: seriesId } = await postRes.json();

    // Attempt to PATCH using clientB's id — should 404 (series doesn't belong to B)
    const patchRes = await PATCH(
      makePatchReq(clientB.id, seriesId, { annualAmount: 99999 }) as never,
      { params: Promise.resolve({ id: clientB.id, seriesId }) },
    );
    expect(patchRes.status).toBe(404);

    // Verify clientA's row was NOT mutated. Without this read-back, the test
    // would still pass if verifyClient(clientB) failed for the wrong reason
    // (e.g. clientB became unreachable) while the WHERE-clientId guard was
    // dropped — pin the actual safety property.
    const { giftSeries } = schema;
    const [original] = await db
      .select()
      .from(giftSeries)
      .where(drizzleOrm.eq(giftSeries.id, seriesId));
    expect(original?.annualAmount).toBe("18000.00");
    expect(original?.clientId).toBe(clientA);
  });
});
