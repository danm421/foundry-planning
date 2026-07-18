import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds, crmHouseholdContacts, crmHouseholdRelationships, familyMembers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { promoteFamilyMember, FamilyMemberNotInHouseholdError } from "../promote-family-member";

const TEST_ORG = "test_org_promote";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("test_org_promote") };
});
vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>("@clerk/nextjs/server");
  return { ...actual, auth: vi.fn().mockResolvedValue({ userId: "test_user", orgId: "test_org_promote" }) };
});

async function seedParentHouseholdWithChild() {
  const [hh] = await db.insert(crmHouseholds).values({
    firmId: TEST_ORG, advisorId: "test_advisor", name: "Cooper Household", state: "PA",
  }).returning();
  const [client] = await db.insert(clients).values({
    firmId: TEST_ORG, advisorId: "test_advisor", crmHouseholdId: hh.id,
    retirementAge: 65, planEndAge: 95, lifeExpectancy: 95, filingStatus: "single",
  }).returning();
  const [child] = await db.insert(familyMembers).values({
    clientId: client.id, firstName: "Sarah", lastName: "Cooper",
    relationship: "child", role: "other", dateOfBirth: "2000-04-01",
  }).returning();
  return { hh, client, child };
}

describe("promoteFamilyMember", () => {
  beforeEach(async () => {
    await db.delete(clients).where(eq(clients.firmId, TEST_ORG));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, TEST_ORG));
  });

  it("creates household + primary contact + child edge atomically", async () => {
    const { hh, child } = await seedParentHouseholdWithChild();
    const result = await promoteFamilyMember(hh.id, {
      sourceFamilyMemberId: child.id,
      firstName: "Sarah", lastName: "Cooper", dateOfBirth: "2000-04-01",
      email: "sarah@example.com", state: "NY",
    });
    expect(result.existing).toBe(false);

    const newHh = await db.query.crmHouseholds.findFirst({ where: eq(crmHouseholds.id, result.householdId) });
    expect(newHh?.name).toBe("Sarah Cooper");
    expect(newHh?.status).toBe("prospect");
    expect(newHh?.state).toBe("NY");

    const contacts = await db.query.crmHouseholdContacts.findMany({
      where: eq(crmHouseholdContacts.householdId, result.householdId),
    });
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      role: "primary", firstName: "Sarah", email: "sarah@example.com", state: "NY",
    });

    const [edge] = await db.query.crmHouseholdRelationships.findMany({
      where: eq(crmHouseholdRelationships.fromHouseholdId, result.householdId),
    });
    expect(edge).toMatchObject({
      toHouseholdId: hh.id, relationshipType: "child", sourceFamilyMemberId: child.id,
    });

    // The child's planning row is untouched.
    const stillThere = await db.query.familyMembers.findFirst({ where: eq(familyMembers.id, child.id) });
    expect(stillThere).toBeTruthy();
  });

  it("is idempotent: second promote returns the existing household", async () => {
    const { hh, child } = await seedParentHouseholdWithChild();
    const first = await promoteFamilyMember(hh.id, {
      sourceFamilyMemberId: child.id, firstName: "Sarah", lastName: "Cooper", state: "NY",
    });
    const second = await promoteFamilyMember(hh.id, {
      sourceFamilyMemberId: child.id, firstName: "Sarah", lastName: "Cooper", state: "NY",
    });
    expect(second).toEqual({ householdId: first.householdId, existing: true });
    const all = await db.query.crmHouseholds.findMany({ where: eq(crmHouseholds.firmId, TEST_ORG) });
    expect(all).toHaveLength(2); // parents + one promoted household, not three
  });

  it("rejects a family member that belongs to a different household's client", async () => {
    const { child } = await seedParentHouseholdWithChild();
    const [otherHh] = await db.insert(crmHouseholds).values({
      firmId: TEST_ORG, advisorId: "test_advisor", name: "Other Household",
    }).returning();
    await expect(
      promoteFamilyMember(otherHh.id, {
        sourceFamilyMemberId: child.id, firstName: "Sarah", lastName: "Cooper", state: "NY",
      }),
    ).rejects.toThrow(FamilyMemberNotInHouseholdError);
  });

  it("promotes a prospect dependent with no planning row (null source)", async () => {
    const [hh] = await db.insert(crmHouseholds).values({
      firmId: TEST_ORG, advisorId: "test_advisor", name: "Prospect Household", state: "PA",
    }).returning();
    const result = await promoteFamilyMember(hh.id, {
      firstName: "Tim", lastName: "Prospect", state: "PA",
    });
    expect(result.existing).toBe(false);
    const [edge] = await db.query.crmHouseholdRelationships.findMany({
      where: eq(crmHouseholdRelationships.fromHouseholdId, result.householdId),
    });
    expect(edge.sourceFamilyMemberId).toBeNull();
  });
});
