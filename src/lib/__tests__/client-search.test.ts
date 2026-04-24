import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq } from "drizzle-orm";
import { searchClients, countClientsForFirm } from "../client-search";

const FIRM_A = "firm_search_a";
const FIRM_B = "firm_search_b";
const ADVISOR_A = "advisor_search_a";
const ADVISOR_B = "advisor_search_b";

async function cleanup() {
  await db.delete(clients).where(eq(clients.firmId, FIRM_A));
  await db.delete(clients).where(eq(clients.firmId, FIRM_B));
}

async function seed() {
  await cleanup();
  await db.insert(clients).values([
    { firmId: FIRM_A, advisorId: ADVISOR_A, firstName: "Alice", lastName: "Anderson", dateOfBirth: "1970-01-01", retirementAge: 65, planEndAge: 95 },
    { firmId: FIRM_A, advisorId: ADVISOR_A, firstName: "Bob", lastName: "Baxter", dateOfBirth: "1965-06-15", retirementAge: 67, planEndAge: 95, spouseName: "Beth", spouseLastName: "Baxter", spouseDob: "1967-09-20", spouseRetirementAge: 67, spouseLifeExpectancy: 95 },
    { firmId: FIRM_B, advisorId: ADVISOR_B, firstName: "Alice", lastName: "Zelenko", dateOfBirth: "1980-02-02", retirementAge: 65, planEndAge: 95 },
  ] as (typeof clients.$inferInsert)[]);
}

beforeAll(seed);
afterAll(cleanup);
beforeEach(seed);

describe("searchClients", () => {
  it("returns matches by first name for the correct firm", async () => {
    const results = await searchClients("alice", ADVISOR_A, FIRM_A);
    expect(results.map((r) => r.householdTitle)).toEqual(["Alice Anderson"]);
  });

  it("returns matches by spouse name", async () => {
    const results = await searchClients("beth", ADVISOR_A, FIRM_A);
    expect(results).toHaveLength(1);
    expect(results[0].householdTitle).toContain("Baxter");
  });

  it("does NOT return clients from another firm", async () => {
    const results = await searchClients("alice", ADVISOR_B, FIRM_B);
    expect(results.map((r) => r.householdTitle)).toEqual(["Alice Zelenko"]);
  });

  it("returns household title with spouse when present", async () => {
    const results = await searchClients("baxter", ADVISOR_A, FIRM_A);
    expect(results[0].householdTitle).toBe("Bob & Beth Baxter");
  });

  it("returns empty array on empty query", async () => {
    const results = await searchClients("", ADVISOR_A, FIRM_A);
    expect(results).toEqual([]);
  });

  it("trims and lowercases the query", async () => {
    const results = await searchClients("  ALICE  ", ADVISOR_A, FIRM_A);
    expect(results.length).toBeGreaterThan(0);
  });

  it("caps results at 8", async () => {
    const more = Array.from({ length: 12 }, (_, i) => ({
      firmId: FIRM_A,
      advisorId: ADVISOR_A,
      firstName: `Spammer${i}`,
      lastName: "Anderson",
      dateOfBirth: "1970-01-01",
      retirementAge: 65,
      planEndAge: 95,
    }));
    await db.insert(clients).values(more as (typeof clients.$inferInsert)[]);
    const results = await searchClients("anderson", ADVISOR_A, FIRM_A);
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
