import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accounts, clients, crmHouseholds, scenarios } from "@/db/schema";
import { getBookKpis } from "../kpis";

const FIRM_A = "firm_homekpis_a";
const FIRM_B = "firm_homekpis_b";
const ADV_A = "adv_homekpis_a";

// "admin" is a non-STAFF role -> resolveVisibleAdvisorIds returns VISIBLE_ALL
// -> no advisor filter, no Clerk. Scoping under test here is firm-level.
const ROLE = "admin";
const TODAY = new Date("2026-07-17T12:00:00Z");

async function makeClient(opts: {
  firmId: string;
  advisorId: string;
  householdName: string;
}): Promise<{ clientId: string; scenarioId: string }> {
  const [hh] = await db
    .insert(crmHouseholds)
    .values({
      firmId: opts.firmId,
      advisorId: opts.advisorId,
      name: opts.householdName,
      status: "active",
    })
    .returning();
  const [client] = await db
    .insert(clients)
    .values({
      firmId: opts.firmId,
      advisorId: opts.advisorId,
      crmHouseholdId: hh.id,
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning();
  const [scenario] = await db
    .insert(scenarios)
    .values({ clientId: client.id, name: "Base Case", isBaseCase: true })
    .returning();
  return { clientId: client.id, scenarioId: scenario.id };
}

async function cleanup() {
  const firmIds = [FIRM_A, FIRM_B];
  const cs = await db
    .select({ id: clients.id })
    .from(clients)
    .where(inArray(clients.firmId, firmIds));
  const clientIds = cs.map((c) => c.id);
  if (clientIds.length) {
    await db.delete(accounts).where(inArray(accounts.clientId, clientIds));
    await db.delete(scenarios).where(inArray(scenarios.clientId, clientIds));
  }
  await db.delete(clients).where(inArray(clients.firmId, firmIds));
  await db.delete(crmHouseholds).where(inArray(crmHouseholds.firmId, firmIds));
}

beforeEach(cleanup);
afterAll(cleanup);

describe("getBookKpis — book value / held-away split", () => {
  it("splits AUM-eligible accounts by the counts_toward_aum flag", async () => {
    const { clientId, scenarioId } = await makeClient({
      firmId: FIRM_A,
      advisorId: ADV_A,
      householdName: "Anderson",
    });
    await db.insert(accounts).values([
      { clientId, scenarioId, name: "Managed brokerage", category: "taxable", subType: "brokerage", value: "200000", countsTowardAum: true },
      { clientId, scenarioId, name: "Held-away 401k", category: "retirement", subType: "401k", value: "150000", countsTowardAum: false },
      { clientId, scenarioId, name: "Held-away checking", category: "cash", subType: "checking", value: "40000", countsTowardAum: false },
    ]);

    const kpis = await getBookKpis(FIRM_A, ADV_A, ROLE, TODAY);

    // Distinct totals on purpose: an implementation that returned the same
    // number for both sides must fail this.
    expect(kpis.totalBookValue).toBe(200000);
    expect(kpis.assetsHeldAway).toBe(190000);
    expect(kpis.heldAwayAccounts).toBe(2);
  });

  it("excludes ineligible categories from BOTH sides of the split", async () => {
    const { clientId, scenarioId } = await makeClient({
      firmId: FIRM_A,
      advisorId: ADV_A,
      householdName: "Baxter",
    });
    await db.insert(accounts).values([
      { clientId, scenarioId, name: "Managed brokerage", category: "taxable", subType: "brokerage", value: "100000", countsTowardAum: true },
      // Flagged while taxable, later recategorised to real_estate. The form's
      // category guard is client-side only, so only the SQL category filter
      // stops this leaking into book value.
      { clientId, scenarioId, name: "Lake house", category: "real_estate", subType: "primary_residence", value: "950000", countsTowardAum: true },
      // Unflagged real estate must not leak into held-away either: held-away
      // means "eligible but unflagged", not "everything unflagged".
      { clientId, scenarioId, name: "Rental", category: "real_estate", subType: "primary_residence", value: "400000", countsTowardAum: false },
    ]);

    const kpis = await getBookKpis(FIRM_A, ADV_A, ROLE, TODAY);

    expect(kpis.totalBookValue).toBe(100000);
    expect(kpis.assetsHeldAway).toBe(0);
    expect(kpis.heldAwayAccounts).toBe(0);
  });

  it("counts only base-case scenarios", async () => {
    const { clientId, scenarioId } = await makeClient({
      firmId: FIRM_A,
      advisorId: ADV_A,
      householdName: "Carter",
    });
    // The accounts_scenario_base_only trigger (migration 0053) rejects any
    // INSERT/UPDATE of accounts.scenario_id that points at a non-base
    // scenario, so `alt` must be created as base-case to accept the insert
    // below, then demoted afterward. The trigger only guards writes to
    // accounts.scenario_id, not writes to scenarios.is_base_case, so this is
    // exactly how a stale account row comes to reference a demoted scenario
    // in production (e.g. after a promote-to-base flow) — not a workaround,
    // the real mechanism.
    const [alt] = await db
      .insert(scenarios)
      .values({ clientId, name: "What-if", isBaseCase: true })
      .returning();
    await db.insert(accounts).values([
      { clientId, scenarioId, name: "Base held-away", category: "taxable", subType: "brokerage", value: "75000", countsTowardAum: false },
      { clientId, scenarioId: alt.id, name: "Alt held-away", category: "taxable", subType: "brokerage", value: "500000", countsTowardAum: false },
    ]);
    await db.update(scenarios).set({ isBaseCase: false }).where(eq(scenarios.id, alt.id));

    const kpis = await getBookKpis(FIRM_A, ADV_A, ROLE, TODAY);

    expect(kpis.assetsHeldAway).toBe(75000);
    expect(kpis.heldAwayAccounts).toBe(1);
  });

  it("scopes the split to the caller's firm", async () => {
    const a = await makeClient({ firmId: FIRM_A, advisorId: ADV_A, householdName: "Ours" });
    const b = await makeClient({ firmId: FIRM_B, advisorId: ADV_A, householdName: "TheirFirm" });
    await db.insert(accounts).values([
      { clientId: a.clientId, scenarioId: a.scenarioId, name: "Ours", category: "cash", subType: "checking", value: "100000", countsTowardAum: false },
      { clientId: b.clientId, scenarioId: b.scenarioId, name: "Theirs", category: "cash", subType: "checking", value: "999999", countsTowardAum: false },
    ]);

    const kpis = await getBookKpis(FIRM_A, ADV_A, ROLE, TODAY);

    expect(kpis.assetsHeldAway).toBe(100000);
    expect(kpis.heldAwayAccounts).toBe(1);
  });

  it("reports zeroes for a firm with no accounts", async () => {
    await makeClient({ firmId: FIRM_A, advisorId: ADV_A, householdName: "Empty" });

    const kpis = await getBookKpis(FIRM_A, ADV_A, ROLE, TODAY);

    expect(kpis.totalBookValue).toBe(0);
    expect(kpis.assetsHeldAway).toBe(0);
    expect(kpis.heldAwayAccounts).toBe(0);
  });
});
