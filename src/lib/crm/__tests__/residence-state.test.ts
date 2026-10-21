/**
 * DB integration test for the CRM household ↔ plan residence-state link.
 *
 * Seeds a household with a planning client and its base case (plan_settings
 * rows exist only for a base case — a trigger refuses any other), plus a
 * household with no planning client.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/db";
import { crmHouseholds, clients, scenarios, planSettings } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { baseCaseResidenceState, writeResidenceStateToPlan } from "../residence-state";

const FIRM = "test-firm-residence-state-2026";
const ADVISOR = "user_test_residence_state";

describe("residence-state link", () => {
  let householdId: string;
  let loneHouseholdId: string;
  let clientId: string;
  let baseScenarioId: string;

  beforeAll(async () => {
    const [hh, lone] = await db
      .insert(crmHouseholds)
      .values([
        { firmId: FIRM, advisorId: ADVISOR, name: "Residence Linked HH", state: "NY" },
        { firmId: FIRM, advisorId: ADVISOR, name: "Residence Lone HH", state: "TX" },
      ])
      .returning();
    householdId = hh.id;
    loneHouseholdId = lone.id;

    const [c] = await db
      .insert(clients)
      .values({
        firmId: FIRM,
        advisorId: ADVISOR,
        crmHouseholdId: householdId,
        retirementAge: 65,
        planEndAge: 95,
        lifeExpectancy: 95,
        filingStatus: "single",
      })
      .returning();
    clientId = c.id;

    const [base] = await db
      .insert(scenarios)
      .values({ clientId, name: "Base Case", isBaseCase: true })
      .returning();
    baseScenarioId = base.id;

    await db.insert(planSettings).values({
      clientId,
      scenarioId: baseScenarioId,
      planStartYear: 2026,
      planEndYear: 2060,
      residenceState: "NY",
    });
  });

  afterAll(async () => {
    await db.delete(planSettings).where(eq(planSettings.clientId, clientId));
    await db.delete(scenarios).where(eq(scenarios.clientId, clientId));
    await db.delete(clients).where(eq(clients.id, clientId));
    await db.delete(crmHouseholds).where(inArray(crmHouseholds.id, [householdId, loneHouseholdId]));
  });

  it("reads the base case's state", async () => {
    expect(await baseCaseResidenceState(db, clientId)).toBe("NY");
  });

  it("writes a household's new state onto its base case", async () => {
    const written = await writeResidenceStateToPlan(db, { householdId, firmId: FIRM, state: "NJ" });
    expect(written?.clientId).toBe(clientId);
    expect(await baseCaseResidenceState(db, clientId)).toBe("NJ");
  });

  it("writes nothing for a household in another firm", async () => {
    expect(await writeResidenceStateToPlan(db, { householdId, firmId: "some-other-firm", state: "CA" })).toBeNull();
    expect(await baseCaseResidenceState(db, clientId)).toBe("NJ");
  });

  it("writes nothing for a household with no planning client", async () => {
    expect(await writeResidenceStateToPlan(db, { householdId: loneHouseholdId, firmId: FIRM, state: "CA" })).toBeNull();
  });
});
