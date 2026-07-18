import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds, crmHouseholdContacts, familyMembers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createCrmContact, updateCrmContact } from "../contacts";
import { createCrmContactSchema } from "../schemas";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("test_org_famlink") };
});

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>("@clerk/nextjs/server");
  return {
    ...actual,
    auth: vi.fn().mockResolvedValue({ userId: "test_user", orgId: "test_org_famlink" }),
  };
});

const FIRM = "test_org_famlink";

async function makeHouseholdWithClient(name: string) {
  const [h] = await db.insert(crmHouseholds).values({
    firmId: FIRM, advisorId: "test_advisor", name,
  }).returning();
  const [client] = await db.insert(clients).values({
    firmId: FIRM, advisorId: "test_advisor",
    retirementAge: 65, planEndAge: 90, crmHouseholdId: h.id,
  }).returning();
  return { householdId: h.id, clientId: client.id };
}

describe("family-linked contact rows", () => {
  let householdId: string;
  let clientId: string;
  let memberId: string;

  beforeEach(async () => {
    // clients FK to crm_households is onDelete:"restrict" — delete clients first.
    await db.delete(clients).where(eq(clients.firmId, FIRM));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, FIRM));
    ({ householdId, clientId } = await makeHouseholdWithClient("Fam Test"));
    const [m] = await db.insert(familyMembers).values({
      clientId, firstName: "Emma", lastName: "Doe", relationship: "child",
    }).returning();
    memberId = m.id;
  });

  it("creates a linked dependent row carrying contact info", async () => {
    const created = await createCrmContact(householdId, {
      role: "dependent", firstName: "Emma", lastName: "Doe",
      familyMemberId: memberId, email: "emma@example.com",
    });
    expect(created.familyMemberId).toBe(memberId);
    expect(created.email).toBe("emma@example.com");
  });

  it("second create for the same family member updates in place (no second row)", async () => {
    await createCrmContact(householdId, {
      role: "dependent", firstName: "Emma", lastName: "Doe",
      familyMemberId: memberId, email: "old@example.com",
    });
    await createCrmContact(householdId, {
      role: "dependent", firstName: "Emma", lastName: "Doe",
      familyMemberId: memberId, email: "new@example.com",
    });
    const rows = await db.query.crmHouseholdContacts.findMany({
      where: eq(crmHouseholdContacts.familyMemberId, memberId),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("new@example.com");
  });

  it("rejects linking a family member from a different household", async () => {
    const other = await makeHouseholdWithClient("Other Fam");
    const [foreign] = await db.insert(familyMembers).values({
      clientId: other.clientId, firstName: "Zoe", lastName: "Smith", relationship: "child",
    }).returning();
    await expect(createCrmContact(householdId, {
      role: "dependent", firstName: "Zoe", lastName: "Smith", familyMemberId: foreign.id,
    })).rejects.toThrow("Family member does not belong to this household");
  });

  it("rejects familyMemberId on update when cross-household", async () => {
    const created = await createCrmContact(householdId, {
      role: "dependent", firstName: "Manual", lastName: "Kid",
    });
    const other = await makeHouseholdWithClient("Other Fam 2");
    const [foreign] = await db.insert(familyMembers).values({
      clientId: other.clientId, firstName: "Zed", relationship: "child",
    }).returning();
    await expect(updateCrmContact(created.id, { familyMemberId: foreign.id }))
      .rejects.toThrow("Family member does not belong to this household");
  });

  it("deleting the planning family member cascades the linked contact row", async () => {
    await createCrmContact(householdId, {
      role: "dependent", firstName: "Emma", lastName: "Doe",
      familyMemberId: memberId, phone: "555-0100",
    });
    await db.delete(familyMembers).where(eq(familyMembers.id, memberId));
    const rows = await db.query.crmHouseholdContacts.findMany({
      where: eq(crmHouseholdContacts.familyMemberId, memberId),
    });
    expect(rows).toHaveLength(0);
  });

  it("persists relationshipLabel on external contacts", async () => {
    const created = await createCrmContact(householdId, {
      role: "other", firstName: "Carl", lastName: "Paulson", relationshipLabel: "CPA",
    });
    expect(created.relationshipLabel).toBe("CPA");
  });
});

describe("contact schema additions", () => {
  it("rejects relationshipLabel over 100 chars and non-uuid familyMemberId", () => {
    expect(createCrmContactSchema.safeParse({
      role: "other", firstName: "A", lastName: "B", relationshipLabel: "x".repeat(101),
    }).success).toBe(false);
    expect(createCrmContactSchema.safeParse({
      role: "dependent", firstName: "A", lastName: "B", familyMemberId: "not-a-uuid",
    }).success).toBe(false);
  });
});
