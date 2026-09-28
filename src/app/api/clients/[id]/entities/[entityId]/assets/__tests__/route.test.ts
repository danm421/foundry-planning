/**
 * Integration tests for POST /api/clients/[id]/entities/[entityId]/assets.
 * Exercises real DB via Drizzle — requires DATABASE_URL; suite is skipped if
 * unavailable (mirrors the gifts route test harness).
 *
 * Covers (Task 9; a gift writes gift rows only since the ownership overlay —
 * `entity_owners` is the authored baseline and is never rewritten by a gift):
 *   1. 100% gift of a client-owned LLC to an irrevocable trust: owners
 *      UNCHANGED; 1 gift row at full value, dated this calendar year.
 *   2. 50% gift with a requested year: owners UNCHANGED; 1 gift row at
 *      value * 0.5, dated the requested year.
 *   3. Transfer to a REVOCABLE trust: ownership transfers, NO gift row.
 *   4. 50/50 client+spouse → 100% to irrevocable trust: owners UNCHANGED;
 *      2 gift rows (one per grantor), each at value / 2.
 *   5. Requested percent exceeds the household share → 400; nothing written.
 *   6. Target entity isn't a trust → 400.
 *   7. Picked entity isn't a business → 400.
 *   8. Non-entity asset type → 400 (handled by per-asset PUT endpoints).
 *   9. Remove on a GIFTED interest deletes the trust's gift rows; owners
 *      UNCHANGED.
 *  10. Remove on a business the trust doesn't own → 400.
 *  11. Remove on an AUTHORED trust row releases it to the family; no gift.
 *  12. A second gift that overdraws what the first left → 400.
 *  13. No year on a plan that starts NEXT year → the gift lands in the plan's
 *      first projection year.
 *  14. An explicit year before the plan start year → 400; nothing written.
 *  15. Remove prunes the scenario changes that targeted the deleted gift rows,
 *      and audits which rows it deleted.
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

// Phase 1b: routes gate via verifyClientAccess → auth() from @clerk/nextjs/server.
// Mock it so the staff-scope check is a no-op (undefined orgRole ⇒ non-staff ⇒
// access turns purely on the firm-scoped clients query the test already drives).
vi.mock("@clerk/nextjs/server", () => ({
  // orgId = TEST_FIRM (inlined — vi.mock is hoisted) so the real verifyClientAccess
  // own-firm path matches and the firm-scoped gate resolves to edit access.
  // sessionClaims include is_founder so requireActiveSubscriptionForFirm passes.
  auth: vi.fn().mockResolvedValue({
    userId: "user_test",
    orgId: "firm_entity_assets_route_test",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  }),
}));

const TEST_FIRM = "firm_entity_assets_route_test";

d("POST /api/clients/[id]/entities/[entityId]/assets", () => {
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
    // entityOwners cascades from entities, but be explicit for hygiene.
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
    await db
      .delete(scenarios)
      .where(drizzleOrm.inArray(scenarios.clientId, ids));
    await db
      .delete(familyMembers)
      .where(drizzleOrm.inArray(familyMembers.clientId, ids));
    await db.delete(clients).where(drizzleOrm.eq(clients.firmId, TEST_FIRM));
  }

  /**
   * Seed minimal client + scenario + the requested family members + an
   * irrevocable (or revocable) trust + a business with the supplied owner
   * percents.
   */
  async function setup(opts: {
    members: Array<{ role: "client" | "spouse"; firstName: string }>;
    trustIrrevocable: boolean;
    businessValue: string;
    /** Owner percents on the business at creation. Each refers to a member
     * by index into `members`. Fractions 0-1. */
    businessOwners: Array<{ memberIdx: number; percent: number }>;
    /** Pre-existing trust-as-owner row on the business (fraction). */
    trustOwnerPct?: number;
    /** Other (non-trust) entity owner row on the business (fraction). */
    otherEntityOwnerPct?: number;
    /** Seeds the base plan's `plan_settings` row with this start year. */
    planStartYear?: number;
  }) {
    const { db } = dbMod;
    const {
      clients,
      scenarios,
      familyMembers,
      entities,
      entityOwners,
    } = schema;

    const [_crmHousehold] = await db


      .insert(crmHouseholds)


      .values({ firmId: TEST_FIRM, advisorId: "advisor_entity_assets_test", name: "Test Household" })


      .returning();


    await db.insert(crmHouseholdContacts).values({


      householdId: _crmHousehold.id,


      role: "primary",


      firstName: "EntityAssets",


      lastName: "Test",


      dateOfBirth: "1970-01-01",


    });


    const [client] = await db
      .insert(clients)
      .values({
        firmId: TEST_FIRM,
        advisorId: "advisor_entity_assets_test",
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
    if (opts.planStartYear != null) {
      // Removed with the scenario (plan_settings cascades on it).
      await db.insert(schema.planSettings).values({
        clientId: client.id,
        scenarioId: scenario.id,
        planStartYear: opts.planStartYear,
        planEndYear: opts.planStartYear + 30,
      });
    }

    const fms = [];
    for (const m of opts.members) {
      const [fm] = await db
        .insert(familyMembers)
        .values({
          clientId: client.id,
          firstName: m.firstName,
          lastName: "Test",
          role: m.role,
        })
        .returning();
      fms.push(fm);
    }

    const [trust] = await db
      .insert(entities)
      .values({
        clientId: client.id,
        name: "Test Trust",
        entityType: "trust" as const,
        trustSubType: opts.trustIrrevocable
          ? ("ilit" as const)
          : ("revocable" as const),
        isIrrevocable: opts.trustIrrevocable,
        grantor: "client" as const,
      })
      .returning();

    const [business] = await db
      .insert(entities)
      .values({
        clientId: client.id,
        name: "Test LLC",
        entityType: "llc" as const,
        value: opts.businessValue,
      })
      .returning();

    // Seed entity_owners rows for the business.
    let otherEntityId: string | undefined;
    if (opts.otherEntityOwnerPct && opts.otherEntityOwnerPct > 0) {
      const [other] = await db
        .insert(entities)
        .values({
          clientId: client.id,
          name: "Other Entity",
          entityType: "partnership" as const,
        })
        .returning();
      otherEntityId = other.id;
    }

    const ownerRows = [];
    for (const o of opts.businessOwners) {
      ownerRows.push({
        entityId: business.id,
        familyMemberId: fms[o.memberIdx].id,
        ownerEntityId: null,
        percent: o.percent.toFixed(4),
      });
    }
    if (opts.trustOwnerPct && opts.trustOwnerPct > 0) {
      ownerRows.push({
        entityId: business.id,
        familyMemberId: null,
        ownerEntityId: trust.id,
        percent: opts.trustOwnerPct.toFixed(4),
      });
    }
    if (otherEntityId && opts.otherEntityOwnerPct) {
      ownerRows.push({
        entityId: business.id,
        familyMemberId: null,
        ownerEntityId: otherEntityId,
        percent: opts.otherEntityOwnerPct.toFixed(4),
      });
    }
    if (ownerRows.length > 0) {
      await db.insert(entityOwners).values(ownerRows);
    }

    return {
      clientId: client.id,
      scenarioId: scenario.id,
      trustId: trust.id,
      businessId: business.id,
      members: fms,
      otherEntityId,
    };
  }

  function makeReq(
    clientId: string,
    entityId: string,
    body: object,
  ): Request {
    return new Request(
      `http://localhost/api/clients/${clientId}/entities/${entityId}/assets`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }

  /** The business's `entity_owners` rows as [familyMemberId | ownerEntityId,
   *  percent], sorted — the authored baseline a gift must leave alone. */
  async function ownersOf(businessId: string) {
    const { db } = dbMod;
    const { entityOwners } = schema;
    const rows = await db
      .select()
      .from(entityOwners)
      .where(drizzleOrm.eq(entityOwners.entityId, businessId));
    return rows
      .map((r) => [r.familyMemberId ?? r.ownerEntityId, parseFloat(r.percent)] as const)
      .sort(([a], [b]) => String(a).localeCompare(String(b)));
  }

  beforeEach(async () => {
    await cleanup();
    vi.mocked(helpers.requireOrgId).mockResolvedValue(TEST_FIRM);
    vi.mocked(helpers.getOrgId).mockResolvedValue(TEST_FIRM);
  });

  // ── tests ──────────────────────────────────────────────────────────────────

  it("1. 100% gift of a client-owned LLC to an ILIT — owners untouched, one gift at full value", async () => {
    const { clientId, trustId, businessId, members } = await setup({
      members: [{ role: "client", firstName: "Alice" }],
      trustIrrevocable: true,
      businessValue: "1000000",
      businessOwners: [{ memberIdx: 0, percent: 1.0 }],
    });
    const { db } = dbMod;
    const { gifts } = schema;

    const res = await POST(
      makeReq(clientId, trustId, {
        op: "add",
        assetType: "entity",
        assetId: businessId,
        percent: 100,
      }) as never,
      { params: Promise.resolve({ id: clientId, entityId: trustId }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.appliedDebit).toBeCloseTo(1.0, 4);

    // The authored baseline is untouched — the engine re-applies the gift.
    expect(await ownersOf(businessId)).toEqual([[members[0].id, 1]]);

    const giftRows = await db
      .select()
      .from(gifts)
      .where(drizzleOrm.eq(gifts.businessEntityId, businessId));
    expect(giftRows).toHaveLength(1);
    expect(giftRows[0].recipientEntityId).toBe(trustId);
    expect(giftRows[0].businessEntityId).toBe(businessId);
    expect(parseFloat(giftRows[0].amount!)).toBeCloseTo(1_000_000, 2);
    expect(parseFloat(giftRows[0].percent!)).toBeCloseTo(1.0, 4);
    expect(giftRows[0].grantor).toBe("client");
    expect(giftRows[0].eventKind).toBe("outright");
    // No year in the body → this calendar year.
    expect(giftRows[0].year).toBe(new Date().getFullYear());
  });

  it("2. 50% gift of a client-owned LLC to an ILIT in a requested year — gift = value * 0.5", async () => {
    const { clientId, trustId, businessId, members } = await setup({
      members: [{ role: "client", firstName: "Alice" }],
      trustIrrevocable: true,
      businessValue: "800000",
      businessOwners: [{ memberIdx: 0, percent: 1.0 }],
    });
    const { db } = dbMod;
    const { gifts } = schema;

    const res = await POST(
      makeReq(clientId, trustId, {
        op: "add",
        assetType: "entity",
        assetId: businessId,
        percent: 50,
        year: 2031,
      }) as never,
      { params: Promise.resolve({ id: clientId, entityId: trustId }) },
    );
    expect(res.status).toBe(200);

    // Client still holds the authored 100%; the trust's 50% is the gift's.
    expect(await ownersOf(businessId)).toEqual([[members[0].id, 1]]);

    const giftRows = await db
      .select()
      .from(gifts)
      .where(drizzleOrm.eq(gifts.businessEntityId, businessId));
    expect(giftRows).toHaveLength(1);
    expect(giftRows[0].year).toBe(2031);
    expect(giftRows[0].recipientEntityId).toBe(trustId);
    expect(parseFloat(giftRows[0].amount!)).toBeCloseTo(400_000, 2);
    expect(parseFloat(giftRows[0].percent!)).toBeCloseTo(0.5, 4);
  });

  it("3. Transfer to REVOCABLE trust — ownership transfers but no gift row", async () => {
    const { clientId, trustId, businessId } = await setup({
      members: [{ role: "client", firstName: "Alice" }],
      trustIrrevocable: false,
      businessValue: "500000",
      businessOwners: [{ memberIdx: 0, percent: 1.0 }],
    });
    const { db } = dbMod;
    const { gifts, entityOwners } = schema;

    const res = await POST(
      makeReq(clientId, trustId, {
        op: "add",
        assetType: "entity",
        assetId: businessId,
        percent: 100,
      }) as never,
      { params: Promise.resolve({ id: clientId, entityId: trustId }) },
    );
    expect(res.status).toBe(200);

    const ownerRows = await db
      .select()
      .from(entityOwners)
      .where(drizzleOrm.eq(entityOwners.entityId, businessId));
    expect(ownerRows).toHaveLength(1);
    expect(ownerRows[0].ownerEntityId).toBe(trustId);

    const giftRows = await db
      .select()
      .from(gifts)
      .where(drizzleOrm.eq(gifts.businessEntityId, businessId));
    expect(giftRows).toHaveLength(0);
  });

  it("4. 50/50 client+co-client → 100% to ILIT — owners untouched, 2 gift rows (one per grantor)", async () => {
    const { clientId, trustId, businessId, members } = await setup({
      members: [
        { role: "client", firstName: "Alice" },
        { role: "spouse", firstName: "Bob" },
      ],
      trustIrrevocable: true,
      businessValue: "2000000",
      businessOwners: [
        { memberIdx: 0, percent: 0.5 },
        { memberIdx: 1, percent: 0.5 },
      ],
    });
    const { db } = dbMod;
    const { gifts } = schema;

    const res = await POST(
      makeReq(clientId, trustId, {
        op: "add",
        assetType: "entity",
        assetId: businessId,
        percent: 100,
      }) as never,
      { params: Promise.resolve({ id: clientId, entityId: trustId }) },
    );
    expect(res.status).toBe(200);

    const giftRows = await db
      .select()
      .from(gifts)
      .where(drizzleOrm.eq(gifts.businessEntityId, businessId));
    expect(giftRows).toHaveLength(2);
    const clientGift = giftRows.find((g) => g.grantor === "client");
    const spouseGift = giftRows.find((g) => g.grantor === "spouse");
    expect(clientGift).toBeDefined();
    expect(spouseGift).toBeDefined();
    expect(parseFloat(clientGift!.amount!)).toBeCloseTo(1_000_000, 2);
    expect(parseFloat(spouseGift!.amount!)).toBeCloseTo(1_000_000, 2);
    expect(parseFloat(clientGift!.percent!)).toBeCloseTo(0.5, 4);
    expect(parseFloat(spouseGift!.percent!)).toBeCloseTo(0.5, 4);
    expect(clientGift!.businessEntityId).toBe(businessId);
    expect(spouseGift!.businessEntityId).toBe(businessId);

    expect(await ownersOf(businessId)).toEqual(
      [[members[0].id, 0.5], [members[1].id, 0.5]]
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    );
  });

  it("5. Requested 100% when only 50% is household-owned — refused, nothing written", async () => {
    // The household can give only its own share. The old route "capped" at
    // 100% by also taking the other entity's 50% — a share nobody gave.
    const { clientId, trustId, businessId } = await setup({
      members: [{ role: "client", firstName: "Alice" }],
      trustIrrevocable: true,
      businessValue: "1000000",
      businessOwners: [{ memberIdx: 0, percent: 0.5 }],
      otherEntityOwnerPct: 0.5,
    });
    const { db } = dbMod;
    const { gifts } = schema;
    const ownersBefore = await ownersOf(businessId);

    const res = await POST(
      makeReq(clientId, trustId, {
        op: "add",
        assetType: "entity",
        assetId: businessId,
        percent: 100,
      }) as never,
      { params: Promise.resolve({ id: clientId, entityId: trustId }) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/household share/i);

    expect(await ownersOf(businessId)).toEqual(ownersBefore);
    const giftRows = await db
      .select()
      .from(gifts)
      .where(drizzleOrm.eq(gifts.businessEntityId, businessId));
    expect(giftRows).toHaveLength(0);
  });

  it("6. Target entity is NOT a trust → 400", async () => {
    const { clientId, businessId } = await setup({
      members: [{ role: "client", firstName: "Alice" }],
      trustIrrevocable: true,
      businessValue: "100000",
      businessOwners: [{ memberIdx: 0, percent: 1.0 }],
    });
    // Use the business itself as the "trust" → should reject.
    const res = await POST(
      makeReq(clientId, businessId, {
        op: "add",
        assetType: "entity",
        assetId: businessId,
        percent: 100,
      }) as never,
      { params: Promise.resolve({ id: clientId, entityId: businessId }) },
    );
    expect(res.status).toBe(400);
  });

  it("7. Picked entity is NOT a business → 400", async () => {
    const { clientId, trustId } = await setup({
      members: [{ role: "client", firstName: "Alice" }],
      trustIrrevocable: true,
      businessValue: "100000",
      businessOwners: [{ memberIdx: 0, percent: 1.0 }],
    });
    // Try to "transfer the trust to itself" — not a business type.
    const res = await POST(
      makeReq(clientId, trustId, {
        op: "add",
        assetType: "entity",
        assetId: trustId,
        percent: 100,
      }) as never,
      { params: Promise.resolve({ id: clientId, entityId: trustId }) },
    );
    expect(res.status).toBe(400);
  });

  it("9. Remove on a GIFTED interest deletes the trust's gift rows and leaves the owners alone", async () => {
    // Give the business to the trust through the route first (an irrevocable
    // trust, so the add writes a gift row and no owner rows).
    const { clientId, trustId, businessId, members } = await setup({
      members: [{ role: "client", firstName: "Alice" }],
      trustIrrevocable: true,
      businessValue: "500000",
      businessOwners: [{ memberIdx: 0, percent: 1.0 }],
    });
    const { db } = dbMod;
    const { gifts } = schema;

    const addRes = await POST(
      makeReq(clientId, trustId, {
        op: "add",
        assetType: "entity",
        assetId: businessId,
        percent: 100,
      }) as never,
      { params: Promise.resolve({ id: clientId, entityId: trustId }) },
    );
    expect(addRes.status).toBe(200);

    const giftsAfterAdd = await db
      .select()
      .from(gifts)
      .where(drizzleOrm.eq(gifts.businessEntityId, businessId));
    expect(giftsAfterAdd).toHaveLength(1);

    // Now exercise the remove path.
    const removeRes = await POST(
      makeReq(clientId, trustId, {
        op: "remove",
        assetType: "entity",
        assetId: businessId,
      }) as never,
      { params: Promise.resolve({ id: clientId, entityId: trustId }) },
    );
    expect(removeRes.status).toBe(200);

    // The client is the sole authored owner throughout.
    expect(await ownersOf(businessId)).toEqual([[members[0].id, 1]]);

    // The gift was the trust's only claim; undoing it deletes it.
    const giftsAfterRemove = await db
      .select()
      .from(gifts)
      .where(drizzleOrm.eq(gifts.businessEntityId, businessId));
    expect(giftsAfterRemove).toHaveLength(0);
  });

  it("10. Remove on a business the trust doesn't own → 400", async () => {
    const { clientId, trustId, businessId } = await setup({
      members: [{ role: "client", firstName: "Alice" }],
      trustIrrevocable: true,
      businessValue: "100000",
      businessOwners: [{ memberIdx: 0, percent: 1.0 }],
    });
    const res = await POST(
      makeReq(clientId, trustId, {
        op: "remove",
        assetType: "entity",
        assetId: businessId,
      }) as never,
      { params: Promise.resolve({ id: clientId, entityId: trustId }) },
    );
    expect(res.status).toBe(400);
  });

  it("11. Remove on an AUTHORED trust row releases it to the family and inserts no gift", async () => {
    const { clientId, trustId, businessId, members } = await setup({
      members: [{ role: "client", firstName: "Alice" }],
      trustIrrevocable: true,
      businessValue: "500000",
      businessOwners: [{ memberIdx: 0, percent: 0.6 }],
      trustOwnerPct: 0.4,
    });
    const { db } = dbMod;
    const { gifts } = schema;

    const res = await POST(
      makeReq(clientId, trustId, {
        op: "remove",
        assetType: "entity",
        assetId: businessId,
      }) as never,
      { params: Promise.resolve({ id: clientId, entityId: trustId }) },
    );
    expect(res.status).toBe(200);

    expect(await ownersOf(businessId)).toEqual([[members[0].id, 1]]);
    const giftRows = await db
      .select()
      .from(gifts)
      .where(drizzleOrm.eq(gifts.businessEntityId, businessId));
    expect(giftRows).toHaveLength(0);
  });

  it("12. A second gift that overdraws what the first left the household → 400", async () => {
    const { clientId, trustId, businessId, members } = await setup({
      members: [{ role: "client", firstName: "Alice" }],
      trustIrrevocable: true,
      businessValue: "1000000",
      businessOwners: [{ memberIdx: 0, percent: 1.0 }],
    });
    const { db } = dbMod;
    const { gifts } = schema;
    const give = (percent: number) =>
      POST(
        makeReq(clientId, trustId, {
          op: "add",
          assetType: "entity",
          assetId: businessId,
          percent,
          year: 2030,
        }) as never,
        { params: Promise.resolve({ id: clientId, entityId: trustId }) },
      );

    expect((await give(70)).status).toBe(200);
    // 30% is left. The AUTHORED owners still say 100%, which is exactly why
    // the check must read the household share the first gift left.
    const second = await give(40);
    expect(second.status).toBe(400);
    expect((await second.json()).error).toMatch(/household share/i);

    const giftRows = await db
      .select()
      .from(gifts)
      .where(drizzleOrm.eq(gifts.businessEntityId, businessId));
    expect(giftRows.map((g) => parseFloat(g.percent!))).toEqual([0.7]);
    expect(await ownersOf(businessId)).toEqual([[members[0].id, 1]]);
  });

  it("13. No year on a plan that starts NEXT year — the gift lands in the plan's first year", async () => {
    // Dated this calendar year, it would precede the projection, which reads a
    // pre-start gift as already folded into the authored owners — so it would
    // move no ownership at all.
    const planStartYear = new Date().getFullYear() + 1;
    const { clientId, trustId, businessId } = await setup({
      members: [{ role: "client", firstName: "Alice" }],
      trustIrrevocable: true,
      businessValue: "1000000",
      businessOwners: [{ memberIdx: 0, percent: 1.0 }],
      planStartYear,
    });
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

    const giftRows = await db
      .select()
      .from(gifts)
      .where(drizzleOrm.eq(gifts.businessEntityId, businessId));
    expect(giftRows.map((g) => g.year)).toEqual([planStartYear]);
  });

  it("14. An explicit year before the plan start year → 400, nothing written", async () => {
    const planStartYear = new Date().getFullYear() + 1;
    const { clientId, trustId, businessId, members } = await setup({
      members: [{ role: "client", firstName: "Alice" }],
      trustIrrevocable: true,
      businessValue: "1000000",
      businessOwners: [{ memberIdx: 0, percent: 1.0 }],
      planStartYear,
    });
    const { db } = dbMod;
    const { gifts } = schema;

    const res = await POST(
      makeReq(clientId, trustId, {
        op: "add",
        assetType: "entity",
        assetId: businessId,
        percent: 30,
        year: planStartYear - 1,
      }) as never,
      { params: Promise.resolve({ id: clientId, entityId: trustId }) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/before the plan start year/i);

    const giftRows = await db
      .select()
      .from(gifts)
      .where(drizzleOrm.eq(gifts.businessEntityId, businessId));
    expect(giftRows).toHaveLength(0);
    expect(await ownersOf(businessId)).toEqual([[members[0].id, 1]]);
  });

  it("15. Remove prunes scenario changes aimed at the deleted gift rows, and audits their ids", async () => {
    // Every other base-row delete prunes the scenario changes that target the
    // row; a change left behind points at an id that no longer exists.
    const { clientId, trustId, businessId, scenarioId } = await setup({
      members: [{ role: "client", firstName: "Alice" }],
      trustIrrevocable: true,
      businessValue: "1000000",
      businessOwners: [{ memberIdx: 0, percent: 1.0 }],
    });
    const { db } = dbMod;
    const { gifts, scenarioChanges } = schema;
    const post = (body: object) =>
      POST(
        makeReq(clientId, trustId, { assetType: "entity", assetId: businessId, ...body }) as never,
        { params: Promise.resolve({ id: clientId, entityId: trustId }) },
      );

    expect((await post({ op: "add", percent: 30 })).status).toBe(200);
    const [gift] = await db
      .select()
      .from(gifts)
      .where(drizzleOrm.eq(gifts.businessEntityId, businessId));
    await db.insert(scenarioChanges).values({
      scenarioId, opType: "edit", targetKind: "gift", targetId: gift.id, payload: {},
    });

    const { recordAudit } = await import("@/lib/audit");
    vi.mocked(recordAudit).mockClear();
    expect((await post({ op: "remove" })).status).toBe(200);

    const left = await db
      .select()
      .from(scenarioChanges)
      .where(drizzleOrm.eq(scenarioChanges.targetId, gift.id));
    expect(left).toHaveLength(0);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ giftRowIdsDeleted: [gift.id] }),
      }),
    );
  });

  it("8. Non-entity asset type returns 400 (handled by per-asset PUT endpoints)", async () => {
    const { clientId, trustId, businessId } = await setup({
      members: [{ role: "client", firstName: "Alice" }],
      trustIrrevocable: true,
      businessValue: "100000",
      businessOwners: [{ memberIdx: 0, percent: 1.0 }],
    });
    const res = await POST(
      makeReq(clientId, trustId, {
        op: "add",
        assetType: "account",
        assetId: businessId,
        percent: 100,
      }) as never,
      { params: Promise.resolve({ id: clientId, entityId: trustId }) },
    );
    expect(res.status).toBe(400);
  });
});
