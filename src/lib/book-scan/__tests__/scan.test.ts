import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/db";
import {
  clients,
  crmHouseholds,
  accounts,
  entities,
  entityOwners,
  scenarios,
  familyMembers,
  crmActivity,
  crmTasks,
  clientOpenItems,
  clientImports,
} from "@/db/schema";
import { inArray } from "drizzle-orm";
import { scanBook } from "../scan";

const FIRM_A = "firm_bookscan_a";
const FIRM_B = "firm_bookscan_b";
const ADV_A = "adv_bookscan_a";
const ADV_B = "adv_bookscan_b";

// returns the created client id + a default scenario id
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
  const cs = await db.select({ id: clients.id }).from(clients).where(inArray(clients.firmId, firmIds));
  const clientIds = cs.map((c) => c.id);
  const hhs = await db.select({ id: crmHouseholds.id }).from(crmHouseholds).where(inArray(crmHouseholds.firmId, firmIds));
  const householdIds = hhs.map((h) => h.id);
  if (clientIds.length) {
    const es = await db.select({ id: entities.id }).from(entities).where(inArray(entities.clientId, clientIds));
    const entIds = es.map((e) => e.id);
    if (entIds.length) await db.delete(entityOwners).where(inArray(entityOwners.entityId, entIds));
    await db.delete(entities).where(inArray(entities.clientId, clientIds));
    await db.delete(accounts).where(inArray(accounts.clientId, clientIds));
    await db.delete(clientOpenItems).where(inArray(clientOpenItems.clientId, clientIds));
    await db.delete(clientImports).where(inArray(clientImports.clientId, clientIds));
    await db.delete(familyMembers).where(inArray(familyMembers.clientId, clientIds));
    // scenarios cascade from clients but delete explicitly for clarity
    await db.delete(scenarios).where(inArray(scenarios.clientId, clientIds));
  }
  if (householdIds.length) {
    await db.delete(crmActivity).where(inArray(crmActivity.householdId, householdIds));
    await db.delete(crmTasks).where(inArray(crmTasks.householdId, householdIds));
  }
  await db.delete(clients).where(inArray(clients.firmId, firmIds));
  await db.delete(crmHouseholds).where(inArray(crmHouseholds.firmId, firmIds));
}

beforeEach(cleanup);
afterAll(cleanup);

describe("scanBook — portfolio signals + scoping", () => {
  it("scopes to the caller's own clients only (not other advisor, not other firm)", async () => {
    await makeClient({ firmId: FIRM_A, advisorId: ADV_A, householdName: "Anderson" });
    await makeClient({ firmId: FIRM_A, advisorId: ADV_B, householdName: "OtherAdvisor" });
    await makeClient({ firmId: FIRM_B, advisorId: ADV_A, householdName: "OtherFirm" });

    const res = await scanBook({ firmId: FIRM_A, advisorId: ADV_A }, {});
    expect(res.rows.map((r) => r.name)).toEqual(["Anderson"]);
    expect(res.totalCount).toBe(1);
  });

  it("sums account value into netWorth/liquid/cashBalance with the liquid exclusions", async () => {
    const { clientId: id, scenarioId } = await makeClient({
      firmId: FIRM_A,
      advisorId: ADV_A,
      householdName: "Baxter",
    });
    await db.insert(accounts).values([
      { clientId: id, scenarioId, name: "Checking", category: "cash", subType: "checking", value: "10000" },
      { clientId: id, scenarioId, name: "Brokerage", category: "taxable", subType: "brokerage", value: "200000" },
      { clientId: id, scenarioId, name: "Home", category: "real_estate", subType: "primary_residence", value: "500000" },
    ]);

    const res = await scanBook({ firmId: FIRM_A, advisorId: ADV_A }, {});
    const row = res.rows.find((r) => r.name === "Baxter")!;
    expect(row.netWorth).toBe(710000); // all three (no business entity)
    expect(row.liquid).toBe(210000); // excludes real_estate
    expect(row.cashBalance).toBe(10000);
  });

  it("adds the clamped family-owned share of business entities to netWorth", async () => {
    const { clientId: id, scenarioId } = await makeClient({
      firmId: FIRM_A,
      advisorId: ADV_A,
      householdName: "Carter",
    });
    await db
      .insert(accounts)
      .values([{ clientId: id, scenarioId, name: "Checking", category: "cash", subType: "checking", value: "1000" }]);
    // business entity worth 100k; owners sum to 0.6 → 60k counted
    const [ent] = await db
      .insert(entities)
      .values({ clientId: id, name: "Carter LLC", entityType: "llc", value: "100000" })
      .returning();
    // need a family member to satisfy the entityOwners CHECK constraint
    const [fm] = await db
      .insert(familyMembers)
      .values({ clientId: id, firstName: "Owner", relationship: "child" })
      .returning();
    await db
      .insert(entityOwners)
      .values([{ entityId: ent.id, familyMemberId: fm.id, ownerEntityId: null, percent: "0.6" }]);

    const res = await scanBook({ firmId: FIRM_A, advisorId: ADV_A }, {});
    const row = res.rows.find((r) => r.name === "Carter")!;
    expect(row.netWorth).toBe(61000); // 1000 cash + 60000 family share
    expect(row.liquid).toBe(1000); // business entity is not an account → not liquid
  });

  it("treats a business entity with no owner rows as fully family-owned", async () => {
    const { clientId: id } = await makeClient({
      firmId: FIRM_A,
      advisorId: ADV_A,
      householdName: "Dunn",
    });
    await db.insert(entities).values({ clientId: id, name: "Dunn S-Corp", entityType: "s_corp", value: "50000" });

    const res = await scanBook({ firmId: FIRM_A, advisorId: ADV_A }, {});
    expect(res.rows.find((r) => r.name === "Dunn")!.netWorth).toBe(50000);
  });
});

describe("scanBook — relationship signals", () => {
  it("derives lastContactDays from the most recent activity, null when none", async () => {
    const withHh = async (name: string) => {
      const [hh] = await db
        .insert(crmHouseholds)
        .values({ firmId: FIRM_A, advisorId: ADV_A, name })
        .returning();
      const [c] = await db
        .insert(clients)
        .values({ firmId: FIRM_A, advisorId: ADV_A, crmHouseholdId: hh.id, retirementAge: 65, planEndAge: 95 })
        .returning();
      return { clientId: c.id, householdId: hh.id };
    };
    const contacted = await withHh("Contacted");
    await withHh("NeverContacted");

    const tenDaysAgo = new Date(Date.now() - 10 * 86400000);
    await db.insert(crmActivity).values({
      householdId: contacted.householdId,
      firmId: FIRM_A,
      kind: "call",
      title: "Check-in call",
      occurredAt: tenDaysAgo,
    });

    const res = await scanBook({ firmId: FIRM_A, advisorId: ADV_A }, {});
    expect(res.rows.find((r) => r.name === "Contacted")!.lastContactDays).toBe(10);
    expect(res.rows.find((r) => r.name === "NeverContacted")!.lastContactDays).toBeNull();
  });

  it("counts open CRM tasks (open/in_progress/blocked) and open planning items, and flags pending imports", async () => {
    const [hh] = await db
      .insert(crmHouseholds)
      .values({ firmId: FIRM_A, advisorId: ADV_A, name: "Workload" })
      .returning();
    const [c] = await db
      .insert(clients)
      .values({ firmId: FIRM_A, advisorId: ADV_A, crmHouseholdId: hh.id, retirementAge: 65, planEndAge: 95 })
      .returning();

    await db.insert(crmTasks).values([
      { firmId: FIRM_A, householdId: hh.id, title: "a", status: "open", createdByUserId: "u1" },
      { firmId: FIRM_A, householdId: hh.id, title: "b", status: "in_progress", createdByUserId: "u1" },
      { firmId: FIRM_A, householdId: hh.id, title: "c", status: "done", createdByUserId: "u1" }, // excluded
    ]);
    await db.insert(clientOpenItems).values([
      { clientId: c.id, title: "x" }, // completedAt null → open
    ]);
    await db.insert(clientImports).values({
      clientId: c.id,
      orgId: FIRM_A,
      mode: "onboarding",
      status: "review",
      createdByUserId: "u1",
    });

    const res = await scanBook({ firmId: FIRM_A, advisorId: ADV_A }, {});
    const row = res.rows.find((r) => r.name === "Workload")!;
    expect(row.openTasks).toBe(2);
    expect(row.openItems).toBe(1);
    expect(row.pendingImport).toBe(true);
  });
});
