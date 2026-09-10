/**
 * Integration tests for GET /api/clients/[id]/gifts?scenario=.
 *
 * A gift forked into a scenario (added via a `gift` scenario change, or a
 * base gift removed/edited-in-place via one) has no footprint a plain
 * `db.select().from(gifts)` can see. Without the `?scenario=` overlay, any
 * client-side list that self-fetches this route goes blind to it. Covers:
 *
 *  1. No `?scenario=` — base rows returned unchanged (no scenario lookup).
 *  2. `?scenario=<sid>` — the scenario's added gift appears, the base gift it
 *     removed is gone, and an untouched base gift survives alongside it.
 *  3. The added row's wire shape matches a real base row's on the numeric
 *     columns (decimal strings, not JS numbers) — RULING 26.
 *  4. An unknown / foreign scenario id 404s rather than silently serving base.
 *
 * Exercises real DB via Drizzle. Requires DATABASE_URL — suite is skipped
 * in CI if unavailable.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { applyEntityAdd, applyEntityRemove } from "@/lib/scenario/changes-writer";

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

// Suppress audit noise in tests. GET doesn't audit today, but mocked
// defensively to match the sibling route test's harness.
vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
  recordCreate: vi.fn().mockResolvedValue(undefined),
  recordUpdate: vi.fn().mockResolvedValue(undefined),
  recordDelete: vi.fn().mockResolvedValue(undefined),
}));

// verifyClientAccess gates via auth() from @clerk/nextjs/server. Mock it so
// the staff-scope check is a no-op (undefined orgRole ⇒ non-staff ⇒ access
// turns purely on the firm-scoped clients query the test already drives).
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({
    userId: "user_test",
    orgId: "firm_gifts_get_scenario_test",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  }),
}));

// A distinct firm id from the sibling route.test.ts's "firm_gifts_route_test"
// — fileParallelism is off (vitest.config.ts) so the two files can't race,
// but a shared firm id would still make one file's cleanup() delete the
// other's fixtures if either ever ran with a stale client left behind.
const TEST_FIRM = "firm_gifts_get_scenario_test";

d("GET /api/clients/[id]/gifts?scenario=", () => {
  let dbMod: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let drizzleOrm: typeof import("drizzle-orm");
  let GET: (typeof import("../route"))["GET"];

  beforeAll(async () => {
    dbMod = await import("@/db");
    schema = await import("@/db/schema");
    drizzleOrm = await import("drizzle-orm");
    ({ GET } = await import("../route"));
  });

  async function cleanup() {
    const { db } = dbMod;
    const { clients, scenarios, familyMembers, gifts } = schema;
    const { inArray, eq } = drizzleOrm;

    const testClients = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.firmId, TEST_FIRM));
    const ids = testClients.map((c) => c.id);
    if (ids.length === 0) return;

    await db.delete(gifts).where(inArray(gifts.clientId, ids));
    await db.delete(scenarios).where(inArray(scenarios.clientId, ids));
    await db.delete(familyMembers).where(inArray(familyMembers.clientId, ids));
    await db.delete(clients).where(eq(clients.firmId, TEST_FIRM));
  }

  /** Seeds a minimal client + one non-base scenario + one family member (a
   *  valid gift recipient). Returns clientId, scenarioId, familyMemberId. */
  async function setupClient() {
    const { db } = dbMod;
    const { clients, scenarios, familyMembers } = schema;

    const [household] = await db
      .insert(crmHouseholds)
      .values({
        firmId: TEST_FIRM,
        advisorId: "advisor_gifts_get_scenario_test",
        name: "Test Household",
      })
      .returning();
    await db.insert(crmHouseholdContacts).values({
      householdId: household.id,
      role: "primary",
      firstName: "Gift",
      lastName: "Scenario",
      dateOfBirth: "1970-01-01",
    });

    const [client] = await db
      .insert(clients)
      .values({
        firmId: TEST_FIRM,
        advisorId: "advisor_gifts_get_scenario_test",
        crmHouseholdId: household.id,
        retirementAge: 65,
        planEndAge: 90,
        lifeExpectancy: 90,
        filingStatus: "single",
      })
      .returning();

    const [scenario] = await db
      .insert(scenarios)
      .values({ clientId: client.id, name: "what-if", isBaseCase: false })
      .returning();

    const [fm] = await db
      .insert(familyMembers)
      .values({
        clientId: client.id,
        firstName: "Gift",
        lastName: "Scenario",
        role: "client" as const,
      })
      .returning();

    return { clientId: client.id, scenarioId: scenario.id, familyMemberId: fm.id };
  }

  function makeGetReq(clientId: string, scenarioId?: string): Request {
    const qs = scenarioId ? `?scenario=${scenarioId}` : "";
    return new Request(`http://localhost/api/clients/${clientId}/gifts${qs}`, {
      method: "GET",
    });
  }

  beforeEach(async () => {
    await cleanup();
  });

  it("returns base gifts unchanged when no scenario is passed", async () => {
    const { clientId, familyMemberId } = await setupClient();
    const { db } = dbMod;
    const { gifts } = schema;

    const [baseGift] = await db
      .insert(gifts)
      .values({
        clientId,
        year: 2026,
        grantor: "client",
        amount: "1000.00",
        recipientFamilyMemberId: familyMemberId,
      })
      .returning();

    const res = await GET(makeGetReq(clientId) as never, {
      params: Promise.resolve({ id: clientId }),
    });
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows.map((r: { id: string }) => r.id)).toEqual([baseGift.id]);
    // Still the raw DB row — a decimal string, not a JS number.
    expect(rows[0].amount).toBe("1000.00");
  });

  it("adds the scenario's added gift, drops the one it removed, and keeps an untouched base gift", async () => {
    const { clientId, scenarioId, familyMemberId } = await setupClient();
    const { db } = dbMod;
    const { gifts } = schema;

    const [removedGift] = await db
      .insert(gifts)
      .values({
        clientId,
        year: 2024,
        grantor: "client",
        amount: "2000.00",
        recipientFamilyMemberId: familyMemberId,
      })
      .returning();

    const [keptGift] = await db
      .insert(gifts)
      .values({
        clientId,
        year: 2025,
        grantor: "client",
        amount: "3000.00",
        valuationDiscount: "0.2500",
        recipientFamilyMemberId: familyMemberId,
      })
      .returning();

    // Remove the base gift inside this scenario — a `remove` marker with no
    // re-materialising `add`, so the overlay strips it and puts nothing back.
    await applyEntityRemove({
      scenarioId,
      firmId: TEST_FIRM,
      targetKind: "gift",
      targetId: removedGift.id,
    });

    // A brand-new gift, born in this scenario.
    const addedId = randomUUID();
    await applyEntityAdd({
      scenarioId,
      firmId: TEST_FIRM,
      targetKind: "gift",
      entity: {
        id: addedId,
        kind: "cash-once",
        year: 2027,
        grantor: "client",
        amount: 5000,
        recipient: { kind: "family_member", id: familyMemberId },
        crummey: false,
        valuationDiscount: 0.1,
      },
    });

    const res = await GET(makeGetReq(clientId, scenarioId) as never, {
      params: Promise.resolve({ id: clientId }),
    });
    expect(res.status).toBe(200);
    const rows = await res.json();
    const ids = rows.map((r: { id: string }) => r.id);
    expect(ids).toContain(addedId);
    expect(ids).toContain(keptGift.id);
    expect(ids).not.toContain(removedGift.id);

    // Year-ascending order survives the overlay (RULING 27): the kept base
    // gift (2025) sorts before the scenario-added one (2027).
    const keptIdx = ids.indexOf(keptGift.id);
    const addedIdx = ids.indexOf(addedId);
    expect(keptIdx).toBeLessThan(addedIdx);

    // RULING 26 — wire-shape parity: the added row's numeric columns must
    // serialize the same way the kept base row's do (decimal strings), not
    // as the JS numbers giftDraftToRow produces internally.
    const kept = rows.find((r: { id: string }) => r.id === keptGift.id);
    const added = rows.find((r: { id: string }) => r.id === addedId);
    expect(typeof kept.amount).toBe("string");
    expect(typeof added.amount).toBe("string");
    expect(added.amount).toBe("5000.00");
    expect(typeof kept.valuationDiscount).toBe("string");
    expect(typeof added.valuationDiscount).toBe("string");
    expect(added.valuationDiscount).toBe("0.1000");
    expect(kept.percent).toBeNull();
    expect(added.percent).toBeNull();
  });

  it("404s for a scenario id that doesn't belong to this client", async () => {
    const { clientId } = await setupClient();
    const bogusScenarioId = "00000000-0000-0000-0000-000000000000";

    const res = await GET(makeGetReq(clientId, bogusScenarioId) as never, {
      params: Promise.resolve({ id: clientId }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Scenario not found");
  });
});
