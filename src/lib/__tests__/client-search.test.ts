import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { searchClients, countClientsForFirm } from "../client-search";

const FIRM_A = "firm_search_a";
const FIRM_B = "firm_search_b";
const ADVISOR_A = "advisor_search_a";
const ADVISOR_B = "advisor_search_b";

type Seed = {
  firmId: string;
  advisorId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  retirementAge: number;
  planEndAge: number;
  spouseFirstName?: string;
  spouseLastName?: string;
  spouseDob?: string;
};

async function insertSeed(seed: Seed): Promise<void> {
  const [household] = await db
    .insert(crmHouseholds)
    .values({ firmId: seed.firmId, advisorId: seed.advisorId, name: `${seed.lastName} Household` })
    .returning();
  await db.insert(crmHouseholdContacts).values({
    householdId: household.id,
    role: "primary",
    firstName: seed.firstName,
    lastName: seed.lastName,
    dateOfBirth: seed.dateOfBirth,
  });
  if (seed.spouseFirstName) {
    await db.insert(crmHouseholdContacts).values({
      householdId: household.id,
      role: "spouse",
      firstName: seed.spouseFirstName,
      lastName: seed.spouseLastName ?? seed.lastName,
      dateOfBirth: seed.spouseDob ?? null,
    });
  }
  await db.insert(clients).values({
    firmId: seed.firmId,
    advisorId: seed.advisorId,
    crmHouseholdId: household.id,
    retirementAge: seed.retirementAge,
    planEndAge: seed.planEndAge,
  });
}

async function cleanup() {
  await db.delete(clients).where(inArray(clients.firmId, [FIRM_A, FIRM_B]));
  await db.delete(crmHouseholds).where(inArray(crmHouseholds.firmId, [FIRM_A, FIRM_B]));
}

async function seed() {
  await cleanup();
  await insertSeed({
    firmId: FIRM_A,
    advisorId: ADVISOR_A,
    firstName: "Alice",
    lastName: "Anderson",
    dateOfBirth: "1970-01-01",
    retirementAge: 65,
    planEndAge: 95,
  });
  await insertSeed({
    firmId: FIRM_A,
    advisorId: ADVISOR_A,
    firstName: "Bob",
    lastName: "Baxter",
    dateOfBirth: "1965-06-15",
    retirementAge: 67,
    planEndAge: 95,
    spouseFirstName: "Beth",
    spouseLastName: "Baxter",
    spouseDob: "1967-09-20",
  });
  await insertSeed({
    firmId: FIRM_B,
    advisorId: ADVISOR_B,
    firstName: "Alice",
    lastName: "Zelenko",
    dateOfBirth: "1980-02-02",
    retirementAge: 65,
    planEndAge: 95,
  });
}

beforeAll(seed);
afterAll(cleanup);
beforeEach(seed);

describe("searchClients", () => {
  it("returns matches by first name for the correct firm", async () => {
    const results = await searchClients("alice", FIRM_A);
    expect(results.map((r) => r.householdTitle)).toEqual(["Alice Anderson"]);
  });

  it("returns matches by spouse name", async () => {
    const results = await searchClients("beth", FIRM_A);
    expect(results).toHaveLength(1);
    expect(results[0].householdTitle).toContain("Baxter");
  });

  it("does NOT return clients from another firm", async () => {
    const results = await searchClients("alice", FIRM_B);
    expect(results.map((r) => r.householdTitle)).toEqual(["Alice Zelenko"]);
  });

  it("returns household title with spouse when present", async () => {
    const results = await searchClients("baxter", FIRM_A);
    expect(results[0].householdTitle).toBe("Bob & Beth Baxter");
  });

  it("returns empty array on empty query", async () => {
    const results = await searchClients("", FIRM_A);
    expect(results).toEqual([]);
  });

  it("trims and lowercases the query", async () => {
    const results = await searchClients("  ALICE  ", FIRM_A);
    expect(results.length).toBeGreaterThan(0);
  });

  it("caps results at 8", async () => {
    for (let i = 0; i < 12; i++) {
      await insertSeed({
        firmId: FIRM_A,
        advisorId: ADVISOR_A,
        firstName: `Spammer${i}`,
        lastName: "Anderson",
        dateOfBirth: "1970-01-01",
        retirementAge: 65,
        planEndAge: 95,
      });
    }
    const results = await searchClients("anderson", FIRM_A);
    expect(results.length).toBeLessThanOrEqual(8);
  });
});

describe("countClientsForFirm", () => {
  it("counts clients for a firm", async () => {
    const count = await countClientsForFirm(FIRM_A);
    expect(count).toBe(2);
  });

  it("returns 0 for a firm with no clients", async () => {
    const count = await countClientsForFirm("firm_does_not_exist");
    expect(count).toBe(0);
  });

  it("scopes strictly by firm", async () => {
    const count = await countClientsForFirm(FIRM_B);
    expect(count).toBe(1);
  });
});
