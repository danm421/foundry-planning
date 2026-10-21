import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  clients,
  crmHouseholds,
  crmHouseholdContacts,
  scenarios,
  familyMembers,
  accounts,
  wills,
  willBequests,
  willBequestRecipients,
  beneficiaryDesignations,
} from "@/db/schema";

// Round-trip test for the built-in Other Heirs recipient: the
// beneficiary_designations.other_heirs marker and the will_recipient_kind
// 'other_heirs' value. Both check rules are hand-written in migrations, so only
// a real write proves them.
//
// This runs against the live Neon dev branch (DATABASE_URL in .env.local).

const firmId = `test-org-other-heirs-recipient-${crypto.randomUUID()}`;
let clientId: string;
let familyMemberId: string;
let accountId: string;
let bequestId: string;

async function setup() {
  const [household] = await db
    .insert(crmHouseholds)
    .values({ firmId, advisorId: "test-advisor", name: "OtherHeirsRecipient Smoke" })
    .returning();

  await db.insert(crmHouseholdContacts).values({
    householdId: household.id,
    role: "primary",
    firstName: "OtherHeirsTest",
    lastName: "Smoke",
    dateOfBirth: "1970-01-01",
  });

  const [client] = await db
    .insert(clients)
    .values({
      firmId,
      advisorId: "test-advisor",
      crmHouseholdId: household.id,
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning();
  clientId = client.id;

  const [scenario] = await db
    .insert(scenarios)
    .values({ clientId, name: "Smoke Scenario", isBaseCase: true })
    .returning();

  const [fm] = await db
    .insert(familyMembers)
    .values({ clientId, firstName: "Child", relationship: "child", role: "other" })
    .returning();
  familyMemberId = fm.id;

  const [account] = await db
    .insert(accounts)
    .values({ clientId, scenarioId: scenario.id, name: "Smoke Brokerage", category: "taxable" })
    .returning();
  accountId = account.id;

  const [will] = await db
    .insert(wills)
    .values({ clientId, grantor: "client" })
    .returning();

  const [bequest] = await db
    .insert(willBequests)
    .values({
      willId: will.id,
      name: "Brokerage",
      kind: "asset",
      assetMode: "specific",
      accountId,
      percentage: "100",
      condition: "always",
      sortOrder: 0,
    })
    .returning();
  bequestId = bequest.id;
}

afterAll(async () => {
  if (clientId) await db.delete(clients).where(eq(clients.id, clientId));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, firmId));
});

describe("Other Heirs as a stored recipient", () => {
  it("setup fixtures", async () => {
    await setup();
    expect(accountId).toBeTruthy();
    expect(bequestId).toBeTruthy();
  });

  it("stores an Other Heirs designation with no other recipient", async () => {
    await expect(
      db.insert(beneficiaryDesignations).values({ clientId, targetKind: "account", accountId, tier: "primary", percentage: "100", otherHeirs: true }),
    ).resolves.toBeDefined();
  });

  it("rejects a designation naming Other Heirs and a family member", async () => {
    await expect(
      db.insert(beneficiaryDesignations).values({ clientId, targetKind: "account", accountId, tier: "primary", percentage: "100", otherHeirs: true, familyMemberId }),
    ).rejects.toThrow();
  });

  it("still rejects a designation naming no one", async () => {
    await expect(
      db.insert(beneficiaryDesignations).values({ clientId, targetKind: "account", accountId, tier: "primary", percentage: "100" }),
    ).rejects.toThrow();
  });

  it("stores an Other Heirs bequest recipient with no recipient id", async () => {
    await expect(
      db.insert(willBequestRecipients).values({ bequestId, recipientKind: "other_heirs", recipientId: null, percentage: "100", sortOrder: 0 }),
    ).resolves.toBeDefined();
  });

  it("rejects an Other Heirs bequest recipient that carries an id", async () => {
    await expect(
      db.insert(willBequestRecipients).values({ bequestId, recipientKind: "other_heirs", recipientId: familyMemberId, percentage: "100", sortOrder: 0 }),
    ).rejects.toThrow();
  });

  it("still rejects a family-member bequest recipient with no id", async () => {
    await expect(
      db.insert(willBequestRecipients).values({ bequestId, recipientKind: "family_member", recipientId: null, percentage: "100", sortOrder: 0 }),
    ).rejects.toThrow();
  });
});
