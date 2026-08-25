import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds, crmHouseholdContacts, firms } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { searchClients, countClientsForFirm, findClientRecipient } from "../client-search";

const FIRM_A = "firm_search_a";
const FIRM_B = "firm_search_b";
const ADVISOR_A = "advisor_search_a";
const ADVISOR_B = "advisor_search_b";

const CALLER_A = { userId: ADVISOR_A, orgRole: "org:member" };
const CALLER_B = { userId: ADVISOR_B, orgRole: "org:member" };

type Seed = {
  firmId: string;
  advisorId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  retirementAge: number;
  planEndAge: number;
  email?: string;
  spouseFirstName?: string;
  spouseLastName?: string;
  spouseDob?: string;
  spouseEmail?: string;
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
    email: seed.email ?? null,
  });
  if (seed.spouseFirstName) {
    await db.insert(crmHouseholdContacts).values({
      householdId: household.id,
      role: "spouse",
      firstName: seed.spouseFirstName,
      lastName: seed.spouseLastName ?? seed.lastName,
      dateOfBirth: seed.spouseDob ?? null,
      email: seed.spouseEmail ?? null,
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
    email: "alice@anderson.test",
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
    // Only the SPOUSE carries an email here, so a role mix-up in the result
    // assembly shows up as Beth's address on the primary.
    spouseEmail: "beth@baxter.test",
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
    const results = await searchClients("alice", FIRM_A, CALLER_A);
    expect(results.map((r) => r.householdTitle)).toEqual(["Alice Anderson"]);
  });

  it("returns matches by spouse name", async () => {
    const results = await searchClients("beth", FIRM_A, CALLER_A);
    expect(results).toHaveLength(1);
    expect(results[0].householdTitle).toContain("Baxter");
  });

  it("does NOT return clients from another firm", async () => {
    const results = await searchClients("alice", FIRM_B, CALLER_B);
    expect(results.map((r) => r.householdTitle)).toEqual(["Alice Zelenko"]);
  });

  it("returns household title with spouse when present", async () => {
    const results = await searchClients("baxter", FIRM_A, CALLER_A);
    expect(results[0].householdTitle).toBe("Bob & Beth Baxter");
  });

  it("returns the primary contact's name and email alongside the title", async () => {
    const [result] = await searchClients("anderson", FIRM_A, CALLER_A);
    expect(result).toMatchObject({
      householdTitle: "Alice Anderson",
      primaryFirstName: "Alice",
      primaryLastName: "Anderson",
      primaryEmail: "alice@anderson.test",
    });
  });

  it("reports a null primary email rather than the spouse's", async () => {
    const [result] = await searchClients("baxter", FIRM_A, CALLER_A);
    expect(result.primaryFirstName).toBe("Bob");
    expect(result.primaryEmail).toBeNull();
  });

  it("returns empty array on empty query", async () => {
    const results = await searchClients("", FIRM_A, CALLER_A);
    expect(results).toEqual([]);
  });

  it("trims and lowercases the query", async () => {
    const results = await searchClients("  ALICE  ", FIRM_A, CALLER_A);
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
    const results = await searchClients("anderson", FIRM_A, CALLER_A);
    expect(results.length).toBeLessThanOrEqual(8);
  });
});

describe("findClientRecipient", () => {
  it("returns the same recipient summary the typeahead does, by id", async () => {
    const [fromSearch] = await searchClients("baxter", FIRM_A, CALLER_A);
    const byId = await findClientRecipient(fromSearch.id, FIRM_A, CALLER_A);
    // Same assembly, so the send card shows the household the same way whether
    // the advisor searched for it or arrived on ?clientId=.
    expect(byId).toEqual(fromSearch);
    expect(byId?.householdTitle).toBe("Bob & Beth Baxter");
  });

  it("carries the primary's email, not the spouse's", async () => {
    const [anderson] = await searchClients("anderson", FIRM_A, CALLER_A);
    const byId = await findClientRecipient(anderson.id, FIRM_A, CALLER_A);
    expect(byId?.primaryEmail).toBe("alice@anderson.test");

    // The Baxter fixture carries an email on the SPOUSE only.
    const [baxter] = await searchClients("baxter", FIRM_A, CALLER_A);
    expect((await findClientRecipient(baxter.id, FIRM_A, CALLER_A))?.primaryEmail).toBeNull();
  });

  it("returns null for a client id belonging to another firm", async () => {
    const [otherFirm] = await searchClients("zelenko", FIRM_B, CALLER_B);
    expect(await findClientRecipient(otherFirm.id, FIRM_A, CALLER_A)).toBeNull();
  });

  it("returns null for a malformed id instead of raising", async () => {
    // `clients.id` is a uuid column: an unguarded query on a query-string value
    // makes Postgres throw, which would 500 the whole Data Collection page.
    expect(await findClientRecipient("not-a-uuid", FIRM_A, CALLER_A)).toBeNull();
  });

  it("returns null for a well-formed id that matches nothing", async () => {
    expect(
      await findClientRecipient("00000000-0000-4000-8000-000000000000", FIRM_A, CALLER_A),
    ).toBeNull();
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

const FIRM_SILO = "firm_search_silo";
const ADVISOR_SILO_A = "advisor_silo_a";
const ADVISOR_SILO_B = "advisor_silo_b";

async function cleanupSilo() {
  await db.delete(clients).where(eq(clients.firmId, FIRM_SILO));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, FIRM_SILO));
  await db.delete(firms).where(eq(firms.firmId, FIRM_SILO));
}

describe("searchClients advisor scope", () => {
  beforeEach(async () => {
    await cleanupSilo();
    await db.insert(firms).values({ firmId: FIRM_SILO, bookSiloEnabled: true });
    await insertSeed({
      firmId: FIRM_SILO,
      advisorId: ADVISOR_SILO_A,
      firstName: "Sia",
      lastName: "Alpha",
      dateOfBirth: "1975-01-01",
      retirementAge: 65,
      planEndAge: 95,
    });
    await insertSeed({
      firmId: FIRM_SILO,
      advisorId: ADVISOR_SILO_B,
      firstName: "Milo",
      lastName: "Beta",
      dateOfBirth: "1976-01-01",
      retirementAge: 65,
      planEndAge: 95,
    });
  });
  afterAll(cleanupSilo);

  it("advisor cannot find another advisor's client when siloed", async () => {
    const results = await searchClients("milo", FIRM_SILO, {
      userId: ADVISOR_SILO_A,
      orgRole: "org:member",
    });
    expect(results.find((r) => r.householdTitle.includes("Milo"))).toBeUndefined();
  });

  it("advisor CAN find their own client when siloed", async () => {
    const results = await searchClients("sia", FIRM_SILO, {
      userId: ADVISOR_SILO_A,
      orgRole: "org:member",
    });
    expect(results.find((r) => r.householdTitle.includes("Sia"))).toBeTruthy();
  });

  it("admin finds everyone even when siloed", async () => {
    const results = await searchClients("milo", FIRM_SILO, {
      userId: "user_admin",
      orgRole: "org:admin",
    });
    expect(results.find((r) => r.householdTitle.includes("Milo"))).toBeTruthy();
  });
});
