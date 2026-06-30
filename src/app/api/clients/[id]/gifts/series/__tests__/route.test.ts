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
import { crmHouseholds, crmHouseholdContacts } from "@/db/schema";
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

vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>("@/lib/db-helpers");
  return {
    ...actual,
    getOrgId: vi.fn(),
    requireOrgId: vi.fn(),
  };
});

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
  recordCreate: vi.fn().mockResolvedValue(undefined),
  recordUpdate: vi.fn().mockResolvedValue(undefined),
  recordDelete: vi.fn().mockResolvedValue(undefined),
}));

// Phase 1b: routes gate via verifyClientAccess → auth() from @clerk/nextjs/server.
// Mock it so the staff-scope check is a no-op (undefined orgRole ⇒ non-staff ⇒
// access turns purely on the firm-scoped clients query the test already drives).
vi.mock("@clerk/nextjs/server", () => ({
  // orgId = TEST_FIRM (inlined — vi.mock is hoisted) so the real verifyClientAccess
  // own-firm path matches and the firm-scoped gate resolves to edit access.
  // sessionClaims include is_founder so requireActiveSubscriptionForFirm passes.
  auth: vi.fn().mockResolvedValue({
    userId: "user_test",
    orgId: "firm_gift_series_route_test",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  }),
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

    const [_crmHousehold] = await db


      .insert(crmHouseholds)


      .values({ firmId: TEST_FIRM, advisorId: "advisor_series_test", name: "Test Household" })


      .returning();


    await db.insert(crmHouseholdContacts).values({


      householdId: _crmHousehold.id,


      role: "primary",


      firstName: "Series",


      lastName: "Test",


      dateOfBirth: "1970-01-01",


    });


    const [client] = await db
      .insert(clients)
      .values({
        firmId: TEST_FIRM,
        advisorId: "advisor_series_test",
        crmHouseholdId: _crmHousehold.id,
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
    const [_crmHousehold] = await db

      .insert(crmHouseholds)

      .values({ firmId: TEST_FIRM, advisorId: "advisor_series_test", name: "Test Household" })

      .returning();

    await db.insert(crmHouseholdContacts).values({

      householdId: _crmHousehold.id,

      role: "primary",

      firstName: "Other",

      lastName: "Client",

      dateOfBirth: "1975-06-15",

    });

    const [clientB] = await db
      .insert(clients)
      .values({
        firmId: TEST_FIRM,
        advisorId: "advisor_series_test",
        crmHouseholdId: _crmHousehold.id,
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

  it("8. POST honors ?scenario= and writes to that partition (not base); GET isolates by partition", async () => {
    const { clientId, entityId, scenarioId: baseScenarioId } = await setupClient();
    const { db } = dbMod;
    const { giftSeries, scenarios } = schema;

    // A second, non-base scenario for the same client.
    const [alt] = await db
      .insert(scenarios)
      .values({ clientId, name: "What-if", isBaseCase: false })
      .returning();

    const giftBody = {
      grantor: "client",
      recipientEntityId: entityId,
      startYear: 2026,
      endYear: 2042,
      annualAmount: 19000,
      inflationAdjust: false,
      useCrummeyPowers: false,
    };

    // POST into the alt scenario — regression: before the fix this landed in base.
    const altRes = await POST(
      new Request(
        `http://localhost/api/clients/${clientId}/gifts/series?scenario=${alt.id}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(giftBody) },
      ) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(altRes.status).toBe(201);
    const altBody = await altRes.json();
    const [altRow] = await db
      .select()
      .from(giftSeries)
      .where(drizzleOrm.eq(giftSeries.id, altBody.id));
    expect(altRow.scenarioId).toBe(alt.id);
    expect(altRow.scenarioId).not.toBe(baseScenarioId);

    // POST with no scenario param still lands in base.
    const baseRes = await POST(
      makePostReq(clientId, giftBody) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(baseRes.status).toBe(201);
    const baseBody = await baseRes.json();
    const [baseRow] = await db
      .select()
      .from(giftSeries)
      .where(drizzleOrm.eq(giftSeries.id, baseBody.id));
    expect(baseRow.scenarioId).toBe(baseScenarioId);

    // GET isolates by partition.
    const getAlt = await GET(
      new Request(`http://localhost/api/clients/${clientId}/gifts/series?scenario=${alt.id}`, { method: "GET" }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(getAlt.status).toBe(200);
    const altList = await getAlt.json();
    expect(altList).toHaveLength(1);
    expect(altList[0].id).toBe(altBody.id);

    const getBase = await GET(
      makeGetReq(clientId) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    const baseList = await getBase.json();
    expect(baseList).toHaveLength(1);
    expect(baseList[0].id).toBe(baseBody.id);
  });

  it("9. POST with a scenario that doesn't belong to the client returns 404 and writes nothing", async () => {
    const { clientId, entityId } = await setupClient();
    const { db } = dbMod;
    const { giftSeries } = schema;

    const bogusScenarioId = "00000000-0000-0000-0000-000000000000";
    const res = await POST(
      new Request(
        `http://localhost/api/clients/${clientId}/gifts/series?scenario=${bogusScenarioId}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            grantor: "client",
            recipientEntityId: entityId,
            startYear: 2026,
            endYear: 2042,
            annualAmount: 19000,
            inflationAdjust: false,
            useCrummeyPowers: false,
          }),
        },
      ) as never,
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(res.status).toBe(404);

    const rows = await db
      .select()
      .from(giftSeries)
      .where(drizzleOrm.eq(giftSeries.clientId, clientId));
    expect(rows).toHaveLength(0);
  });

  it("10. POST with recipientFamilyMemberId belonging to this client → 201 and persists recipientFamilyMemberId", async () => {
    const { clientId, familyMemberId, scenarioId } = await setupClient();
    const { db } = dbMod;
    const { giftSeries } = schema;

    const res = await POST(
      makePostReq(clientId, {
        grantor: "client",
        recipientFamilyMemberId: familyMemberId,
        startYear: 2026,
        endYear: 2035,
        annualAmount: 18000,
        inflationAdjust: false,
        useCrummeyPowers: false,
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
    expect(row.recipientFamilyMemberId).toBe(familyMemberId);
    expect(row.recipientEntityId).toBeNull();
    expect(row.recipientExternalBeneficiaryId).toBeNull();
  });

  it("11. POST with a recipientFamilyMemberId belonging to another client returns 400", async () => {
    const { clientId: clientA } = await setupClient();

    // Create a second client + a family member that belongs to clientB only.
    const { db } = dbMod;
    const { clients, scenarios, familyMembers } = schema;
    const [_crmHousehold] = await db
      .insert(crmHouseholds)
      .values({ firmId: TEST_FIRM, advisorId: "advisor_series_test", name: "Other Household" })
      .returning();
    await db.insert(crmHouseholdContacts).values({
      householdId: _crmHousehold.id,
      role: "primary",
      firstName: "Other",
      lastName: "Person",
      dateOfBirth: "1980-03-15",
    });
    const [clientB] = await db
      .insert(clients)
      .values({
        firmId: TEST_FIRM,
        advisorId: "advisor_series_test",
        crmHouseholdId: _crmHousehold.id,
        retirementAge: 65,
        planEndAge: 90,
        lifeExpectancy: 90,
        filingStatus: "single",
      })
      .returning();
    await db
      .insert(scenarios)
      .values({ clientId: clientB.id, name: "base", isBaseCase: true });
    const [fmB] = await db
      .insert(familyMembers)
      .values({
        clientId: clientB.id,
        firstName: "Bob",
        lastName: "B",
        role: "client" as const,
      })
      .returning();

    // Attempt to POST under clientA using clientB's family member id.
    const res = await POST(
      makePostReq(clientA, {
        grantor: "client",
        recipientFamilyMemberId: fmB.id,
        startYear: 2026,
        endYear: 2030,
        annualAmount: 18000,
        inflationAdjust: false,
        useCrummeyPowers: false,
      }) as never,
      { params: Promise.resolve({ id: clientA }) },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Recipient family member not found for this client");
  });
});
