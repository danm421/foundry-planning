// src/lib/fact-finder/__tests__/records-load.test.ts
//
// Live dev database: proves each query's client and scenario scoping against
// real rows. Everything lives under a firm id no other suite uses.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  clients,
  crmHouseholds,
  disabilityPolicies,
  externalBeneficiaries,
  familyMembers,
  gifts,
  notesReceivable,
  savingsRules,
} from "@/db/schema";
import { createTestClientWithScenario } from "@/test/factories";
import { loadExistingRecords, resolveBaseCaseScenarioId } from "../records/load";

const FIRM = "firm_test_fact_finder_records";
const HAS_DB = !!process.env.DATABASE_URL;
let clientId: string;
let scenarioId: string;
let otherClientId: string;

async function dropFirm() {
  const rows = await db.select({ id: clients.id, householdId: clients.crmHouseholdId }).from(clients).where(eq(clients.firmId, FIRM));
  if (rows.length === 0) return;
  const ids = rows.map((r) => r.id);
  await db.delete(gifts).where(inArray(gifts.clientId, ids));
  await db.delete(clients).where(inArray(clients.id, ids));
  await db.delete(crmHouseholds).where(inArray(crmHouseholds.id, rows.map((r) => r.householdId)));
}

describe.skipIf(!HAS_DB)("loadExistingRecords (live DB)", () => {
  beforeAll(async () => {
    await dropFirm();
    ({ clientId, scenarioId } = await createTestClientWithScenario(FIRM));
    const other = await createTestClientWithScenario(FIRM);
    otherClientId = other.clientId;

    // A brokerage account, not an IRA: the deferred one-owner trigger on
    // retirement accounts would reject an ownerless IRA at commit.
    const [brokerage] = await db
      .insert(accounts)
      .values({ clientId, scenarioId, name: "Schwab Brokerage", category: "taxable", subType: "brokerage", accountNumberLast4: "7731", custodian: "Charles Schwab", value: "310000" })
      .returning({ id: accounts.id });
    await db.insert(accounts).values({ clientId: otherClientId, scenarioId: other.scenarioId, name: "Not ours", category: "cash" });
    await db.insert(savingsRules).values({ clientId, scenarioId, accountId: brokerage.id, startYear: 2026, endYear: 2030 });
    const [child] = await db
      .insert(familyMembers)
      .values({ clientId, firstName: "Emma", lastName: "Hendricks", relationship: "child", dateOfBirth: "2004-05-21" })
      .returning({ id: familyMembers.id });
    await db.insert(externalBeneficiaries).values({ clientId, name: "Denver Rescue Mission" });
    await db.insert(disabilityPolicies).values({ clientId, name: "Acme LTD", insured: "client", carrier: "Unum" });
    await db.insert(notesReceivable).values({
      clientId, scenarioId, name: "Loan to Lucas", faceValue: "20000", basis: "20000",
      paymentType: "amortizing", startYear: 2024, termMonths: 60,
    });
    await db.insert(gifts).values({ clientId, year: 2022, grantor: "joint", amount: "34000", recipientFamilyMemberId: child.id });
  });
  afterAll(dropFirm);

  it("finds the client's base case", async () => {
    expect(await resolveBaseCaseScenarioId(clientId)).toBe(scenarioId);
    expect(await resolveBaseCaseScenarioId("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("loads this client's records only, with numbers as numbers", async () => {
    const r = await loadExistingRecords(clientId, scenarioId);
    expect(r.candidates.accounts.map((a) => a.name)).toEqual(["Schwab Brokerage"]);
    expect(r.candidates.accounts[0].value).toBe(310000);
    expect(r.candidates.familyMembers.map((f) => f.firstName)).toContain("Emma");
    expect(r.savingsRules).toEqual([{ id: expect.any(String), accountId: expect.any(String), accountName: "Schwab Brokerage" }]);
    expect(r.externalBeneficiaries.map((e) => e.name)).toEqual(["Denver Rescue Mission"]);
    expect(r.disabilityPolicies).toEqual([{ id: expect.any(String), name: "Acme LTD", insured: "client", carrier: "Unum" }]);
    expect(r.notesReceivable).toEqual([{ id: expect.any(String), name: "Loan to Lucas", faceValue: 20000 }]);
    expect(r.gifts).toEqual([{ id: expect.any(String), year: 2022, grantor: "joint", amount: 34000 }]);
    expect(r.ltcPolicies).toEqual([]);
    expect(r.stockOptionGrants).toEqual([]);
  });
});
