import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { accounts, clients, crmHouseholds, scenarios } from "@/db/schema";
import { getBookKpis } from "../kpis";
import { getBookBreakdown } from "../book-breakdown";

const FIRM_A = "firm_bookbreakdown_a";
const FIRM_B = "firm_bookbreakdown_b";
const ADV_A = "adv_bookbreakdown_a";
const ROLE = "admin"; // non-STAFF -> VISIBLE_ALL, no Clerk; firm scoping under test
const TODAY = new Date("2026-07-17T12:00:00Z");

async function makeClient(opts: { firmId: string; advisorId: string; householdName: string }) {
  const [hh] = await db
    .insert(crmHouseholds)
    .values({ firmId: opts.firmId, advisorId: opts.advisorId, name: opts.householdName, status: "active" })
    .returning();
  const [client] = await db
    .insert(clients)
    .values({ firmId: opts.firmId, advisorId: opts.advisorId, crmHouseholdId: hh.id, retirementAge: 65, planEndAge: 95 })
    .returning();
  const [scenario] = await db
    .insert(scenarios)
    .values({ clientId: client.id, name: "Base Case", isBaseCase: true })
    .returning();
  return { householdId: hh.id, clientId: client.id, scenarioId: scenario.id };
}

async function cleanup() {
  const firmIds = [FIRM_A, FIRM_B];
  const cs = await db.select({ id: clients.id }).from(clients).where(inArray(clients.firmId, firmIds));
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

describe("getBookBreakdown", () => {
  it("totals equal getBookKpis for the same firm", async () => {
    const a = await makeClient({ firmId: FIRM_A, advisorId: ADV_A, householdName: "Anderson" });
    await db.insert(accounts).values([
      { clientId: a.clientId, scenarioId: a.scenarioId, name: "Brokerage", category: "taxable", subType: "brokerage", value: "200000", countsTowardAum: true },
      { clientId: a.clientId, scenarioId: a.scenarioId, name: "Held IRA", category: "retirement", subType: "traditional_ira", value: "50000", countsTowardAum: false },
      { clientId: a.clientId, scenarioId: a.scenarioId, name: "Home", category: "real_estate", subType: "primary_residence", value: "900000", countsTowardAum: false }, // ineligible: excluded both sides
    ]);

    const [kpis, breakdown] = await Promise.all([
      getBookKpis(FIRM_A, ADV_A, ROLE, TODAY),
      getBookBreakdown(FIRM_A, ADV_A, ROLE),
    ]);
    expect(breakdown.totals.bookValue).toBeCloseTo(kpis.totalBookValue, 2);
    expect(breakdown.totals.heldAway).toBeCloseTo(kpis.assetsHeldAway, 2);
    expect(breakdown.totals.heldAwayAccounts).toBe(kpis.heldAwayAccounts);
    // real_estate excluded from both sides
    expect(breakdown.totals.bookValue).toBeCloseTo(200000, 2);
    expect(breakdown.totals.heldAway).toBeCloseTo(50000, 2);
  });

  it("scopes to the firm and excludes other firms", async () => {
    const a = await makeClient({ firmId: FIRM_A, advisorId: ADV_A, householdName: "Anderson" });
    const other = await makeClient({ firmId: FIRM_B, advisorId: ADV_A, householdName: "OtherFirm" });
    await db.insert(accounts).values([
      { clientId: a.clientId, scenarioId: a.scenarioId, name: "Brokerage", category: "taxable", subType: "brokerage", value: "100000", countsTowardAum: true },
      { clientId: other.clientId, scenarioId: other.scenarioId, name: "Brokerage", category: "taxable", subType: "brokerage", value: "999999", countsTowardAum: true },
    ]);
    const breakdown = await getBookBreakdown(FIRM_A, ADV_A, ROLE);
    expect(breakdown.households.map((h) => h.householdName)).toEqual(["Anderson"]);
    expect(breakdown.totals.bookValue).toBeCloseTo(100000, 2);
  });
});
