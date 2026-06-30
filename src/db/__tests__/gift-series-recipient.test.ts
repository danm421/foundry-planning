import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  clients,
  crmHouseholds,
  crmHouseholdContacts,
  scenarios,
  familyMembers,
  externalBeneficiaries,
  giftSeries,
} from "@/db/schema";

// Round-trip test for the gift_series recipient column generalization.
// Migration 0192 makes recipient_entity_id nullable and adds
// recipient_family_member_id + recipient_external_beneficiary_id (both nullable)
// with a CHECK constraint requiring exactly one non-null across the three columns.
//
// This runs against the live Neon dev branch (DATABASE_URL in .env.local).

const firmId = `test-org-gift-series-recipient-${crypto.randomUUID()}`;
let clientId: string;
let scenarioId: string;
let familyMemberId: string;
let externalBeneficiaryId: string;

// ── Setup ─────────────────────────────────────────────────────────────────────

async function setup() {
  const [household] = await db
    .insert(crmHouseholds)
    .values({ firmId, advisorId: "test-advisor", name: "GiftSeriesRecipient Smoke" })
    .returning();

  await db.insert(crmHouseholdContacts).values({
    householdId: household.id,
    role: "primary",
    firstName: "GiftSeriesTest",
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
  scenarioId = scenario.id;

  const [fm] = await db
    .insert(familyMembers)
    .values({ clientId, firstName: "Child", relationship: "child", role: "other" })
    .returning();
  familyMemberId = fm.id;

  const [eb] = await db
    .insert(externalBeneficiaries)
    .values({ clientId, name: "Smoke Charity", kind: "charity" })
    .returning();
  externalBeneficiaryId = eb.id;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

afterAll(async () => {
  // Cascade: deleting the client removes scenarios, gift_series, family_members,
  // external_beneficiaries. Deleting the household removes the contact + client.
  if (clientId) await db.delete(clients).where(eq(clients.id, clientId));
  // crmHousehold has onDelete:restrict on clients, so delete after client is gone.
  await db
    .delete(crmHouseholds)
    .where(eq(crmHouseholds.firmId, firmId));
});

// ── Shared row builder ────────────────────────────────────────────────────────

const baseRow = () => ({
  clientId: "" as string,  // filled in tests after setup
  scenarioId: "" as string,
  grantor: "client" as const,
  startYear: 2025,
  endYear: 2030,
  annualAmount: "10000",
  amountMode: "fixed" as const,
  inflationAdjust: false,
  useCrummeyPowers: false,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("gift_series recipient generalization (migration 0192)", () => {
  it("setup fixtures", async () => {
    await setup();
    expect(clientId).toBeTruthy();
    expect(scenarioId).toBeTruthy();
    expect(familyMemberId).toBeTruthy();
    expect(externalBeneficiaryId).toBeTruthy();
  });

  it("persists a family-member recipient row and reads it back", async () => {
    const [inserted] = await db
      .insert(giftSeries)
      .values({
        ...baseRow(),
        clientId,
        scenarioId,
        recipientFamilyMemberId: familyMemberId,
      })
      .returning();

    expect(inserted.recipientFamilyMemberId).toBe(familyMemberId);
    expect(inserted.recipientEntityId).toBeNull();
    expect(inserted.recipientExternalBeneficiaryId).toBeNull();

    // Read back from DB
    const [fetched] = await db
      .select()
      .from(giftSeries)
      .where(eq(giftSeries.id, inserted.id));
    expect(fetched.recipientFamilyMemberId).toBe(familyMemberId);
    expect(fetched.recipientEntityId).toBeNull();

    // Cleanup this row
    await db.delete(giftSeries).where(eq(giftSeries.id, inserted.id));
  });

  it("persists an external-beneficiary recipient row and reads it back", async () => {
    const [inserted] = await db
      .insert(giftSeries)
      .values({
        ...baseRow(),
        clientId,
        scenarioId,
        recipientExternalBeneficiaryId: externalBeneficiaryId,
      })
      .returning();

    expect(inserted.recipientExternalBeneficiaryId).toBe(externalBeneficiaryId);
    expect(inserted.recipientEntityId).toBeNull();
    expect(inserted.recipientFamilyMemberId).toBeNull();

    await db.delete(giftSeries).where(eq(giftSeries.id, inserted.id));
  });

  it("rejects an insert with TWO recipient columns set (check constraint)", async () => {
    await expect(
      db.insert(giftSeries).values({
        ...baseRow(),
        clientId,
        scenarioId,
        recipientFamilyMemberId: familyMemberId,
        recipientExternalBeneficiaryId: externalBeneficiaryId,
      }),
    ).rejects.toThrow();
  });

  it("rejects an insert with ZERO recipient columns set (check constraint)", async () => {
    await expect(
      db.insert(giftSeries).values({
        ...baseRow(),
        clientId,
        scenarioId,
        // no recipient columns — all null
      }),
    ).rejects.toThrow();
  });
});
