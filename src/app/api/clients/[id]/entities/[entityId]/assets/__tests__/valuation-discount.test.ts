/**
 * Task 13 — the advisor's valuation discount reaches the auto-created §709
 * gift row when a business interest is assigned to an irrevocable trust.
 *
 * Integration test against POST /api/clients/[id]/entities/[entityId]/assets.
 * Exercises the real DB via Drizzle — requires DATABASE_URL; the suite is
 * skipped if unavailable (same harness as the sibling `route.test.ts`).
 *
 * Its own TEST_FIRM, distinct from the sibling suite's, so the two files can
 * run in parallel without their firm-scoped cleanups deleting each other's
 * fixtures.
 *
 * Covers:
 *   1. `valuationDiscount` is persisted as a fraction alongside the FULL
 *      undiscounted `amount` (the discount is applied downstream, in the
 *      normalizer — pre-multiplying here would double-discount).
 *   2. A `valuationDiscount` of 1 is rejected with a 400.
 *   3. Omitting the field writes NULL, not 0.
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
  // .env.local not present — the skip guard below handles this.
}

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>(
    "@/lib/db-helpers",
  );
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

// Routes gate via requireClientEditAccess → auth() from @clerk/nextjs/server.
// orgId is inlined (vi.mock is hoisted) so the own-firm path matches; an
// undefined orgRole means non-staff, so access turns purely on the firm-scoped
// clients query the fixtures drive. is_founder satisfies the subscription gate.
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({
    userId: "user_test",
    orgId: "firm_entity_assets_discount_test",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  }),
}));

const TEST_FIRM = "firm_entity_assets_discount_test";
const ADVISOR = "advisor_entity_assets_discount_test";

d("POST .../entities/[entityId]/assets — valuation discount", () => {
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
    const { clients, scenarios, familyMembers, entities, gifts, entityOwners } =
      schema;

    const testClients = await db
      .select({ id: clients.id })
      .from(clients)
      .where(drizzleOrm.eq(clients.firmId, TEST_FIRM));
    const ids = testClients.map((c) => c.id);
    if (ids.length === 0) return;

    await db.delete(gifts).where(drizzleOrm.inArray(gifts.clientId, ids));
    const entityIds = await db
      .select({ id: entities.id })
      .from(entities)
      .where(drizzleOrm.inArray(entities.clientId, ids));
    if (entityIds.length > 0) {
      await db.delete(entityOwners).where(
        drizzleOrm.inArray(
          entityOwners.entityId,
          entityIds.map((e) => e.id),
        ),
      );
    }
    await db.delete(entities).where(drizzleOrm.inArray(entities.clientId, ids));
    await db.delete(scenarios).where(drizzleOrm.inArray(scenarios.clientId, ids));
    await db
      .delete(familyMembers)
      .where(drizzleOrm.inArray(familyMembers.clientId, ids));
    await db.delete(clients).where(drizzleOrm.eq(clients.firmId, TEST_FIRM));
  }

  /** Client + base scenario + one client family member owning 100% of a
   *  $1,000,000 LLC, plus an irrevocable trust to receive the interest. */
  async function setup() {
    const { db } = dbMod;
    const { clients, scenarios, familyMembers, entities, entityOwners } = schema;

    const [household] = await db
      .insert(crmHouseholds)
      .values({ firmId: TEST_FIRM, advisorId: ADVISOR, name: "Test Household" })
      .returning();
    await db.insert(crmHouseholdContacts).values({
      householdId: household.id,
      role: "primary",
      firstName: "Discount",
      lastName: "Test",
      dateOfBirth: "1970-01-01",
    });

    const [client] = await db
      .insert(clients)
      .values({
        firmId: TEST_FIRM,
        advisorId: ADVISOR,
        crmHouseholdId: household.id,
        retirementAge: 65,
        planEndAge: 90,
        lifeExpectancy: 90,
        filingStatus: "single",
      })
      .returning();

    await db
      .insert(scenarios)
      .values({ clientId: client.id, name: "base", isBaseCase: true });

    const [fm] = await db
      .insert(familyMembers)
      .values({
        clientId: client.id,
        firstName: "Alice",
        lastName: "Test",
        role: "client" as const,
      })
      .returning();

    const [trust] = await db
      .insert(entities)
      .values({
        clientId: client.id,
        name: "Test Trust",
        entityType: "trust" as const,
        trustSubType: "ilit" as const,
        isIrrevocable: true,
        grantor: "client" as const,
      })
      .returning();

    const [business] = await db
      .insert(entities)
      .values({
        clientId: client.id,
        name: "Test LLC",
        entityType: "llc" as const,
        value: "1000000",
      })
      .returning();

    await db.insert(entityOwners).values({
      entityId: business.id,
      familyMemberId: fm.id,
      ownerEntityId: null,
      percent: "1.0000",
    });

    return { clientId: client.id, trustId: trust.id, businessId: business.id };
  }

  function makeReq(clientId: string, entityId: string, body: object): Request {
    return new Request(
      `http://localhost/api/clients/${clientId}/entities/${entityId}/assets`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }

  beforeEach(async () => {
    await cleanup();
    vi.mocked(helpers.requireOrgId).mockResolvedValue(TEST_FIRM);
    vi.mocked(helpers.getOrgId).mockResolvedValue(TEST_FIRM);
  });

  it("writes valuationDiscount alongside the FULL-value amount on the auto-created gift row", async () => {
    // Business valued at $1,000,000, client holds 100%, assigning 30% to the
    // irrevocable trust with a 35% appraisal discount.
    const { clientId, trustId, businessId } = await setup();
    const { db } = dbMod;
    const { gifts } = schema;

    const res = await POST(
      makeReq(clientId, trustId, {
        op: "add",
        assetType: "entity",
        assetId: businessId,
        percent: 30,
        valuationDiscount: 0.35,
      }) as never,
      { params: Promise.resolve({ id: clientId, entityId: trustId }) },
    );
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(gifts)
      .where(
        drizzleOrm.and(
          drizzleOrm.eq(gifts.clientId, clientId),
          drizzleOrm.eq(gifts.businessEntityId, businessId),
        ),
      );
    expect(rows).toHaveLength(1);
    // amount stays the FULL value — the discount is applied downstream, in the
    // normalizer, so `amount` remains a truthful fair-market figure.
    expect(Number(rows[0].amount)).toBeCloseTo(300_000, 2);
    expect(Number(rows[0].percent)).toBeCloseTo(0.3, 4);
    expect(Number(rows[0].valuationDiscount)).toBeCloseTo(0.35, 4);

    // Audited too. The discount is the one value this mutation writes that
    // changes lifetime-exemption consumption, so it belongs in the record.
    const { recordAudit } = await import("@/lib/audit");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ valuationDiscount: 0.35 }),
      }),
    );
  });

  // 400, never 500: an out-of-range discount must be refused by the schema, not
  // by the column. 0.99995 is the trap — `numeric(6,4)` rounds half away from
  // zero BEFORE the CHECK runs, so it stores as 1.0000 and trips
  // `valuation_discount < 1`; a Zod bound of `.lt(1)` would let that whole
  // window through and turn a should-have-been-400 into a rolled-back 500.
  it.each([
    ["exactly 1", 1],
    ["0.99995 — rounds up to 1.0000 in numeric(6,4)", 0.99995],
    ["a negative discount", -0.1],
  ])("rejects %s with a 400", async (_label, discount) => {
    const { clientId, trustId, businessId } = await setup();

    const res = await POST(
      makeReq(clientId, trustId, {
        op: "add",
        assetType: "entity",
        assetId: businessId,
        percent: 30,
        valuationDiscount: discount,
      }) as never,
      { params: Promise.resolve({ id: clientId, entityId: trustId }) },
    );
    expect(res.status).toBe(400);
  });

  it("writes a NULL discount when the advisor leaves the field blank", async () => {
    const { clientId, trustId, businessId } = await setup();
    const { db } = dbMod;
    const { gifts } = schema;

    const res = await POST(
      makeReq(clientId, trustId, {
        op: "add",
        assetType: "entity",
        assetId: businessId,
        percent: 30,
      }) as never,
      { params: Promise.resolve({ id: clientId, entityId: trustId }) },
    );
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(gifts)
      .where(
        drizzleOrm.and(
          drizzleOrm.eq(gifts.clientId, clientId),
          drizzleOrm.eq(gifts.businessEntityId, businessId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].valuationDiscount).toBeNull();
  });
});
