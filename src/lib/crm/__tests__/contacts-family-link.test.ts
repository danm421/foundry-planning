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

  it("rejects familyMemberId on update against a non-dependent row", async () => {
    // updateCrmContactSchema accepts familyMemberId on ANY role and the
    // ownership check only validates household membership, so before the guard
    // this PATCH succeeded and hung a planning link off an external contact.
    const external = await createCrmContact(householdId, {
      role: "other", firstName: "Carl", lastName: "Paulson",
    });
    await expect(updateCrmContact(external.id, { familyMemberId: memberId }))
      .rejects.toThrow("Family member link requires the dependent role");

    const row = await db.query.crmHouseholdContacts.findFirst({
      where: eq(crmHouseholdContacts.id, external.id),
    });
    expect(row?.familyMemberId).toBeNull();
  });

  it("allows familyMemberId on update when the same patch sets role dependent", async () => {
    // The role is resolved against the patch, not just the stored row, so
    // promoting an unlinked contact to a linked dependent in one PATCH works.
    const orphan = await createCrmContact(householdId, {
      role: "other", firstName: "Emma", lastName: "Doe",
    });
    const updated = await updateCrmContact(orphan.id, {
      role: "dependent", familyMemberId: memberId,
    });
    expect(updated.familyMemberId).toBe(memberId);
  });

  // Every nullable column createCrmContact writes on INSERT. A field missing
  // from the ON CONFLICT set is silently dropped on re-link while the caller
  // still gets a 201, so both directions are asserted over the WHOLE set rather
  // than over whichever fields a review happened to name.
  const FULL_CONTACT = {
    preferredName: "Em", dateOfBirth: "2010-04-02",
    email: "emma@example.com", phone: "555-0100", mobile: "555-0199",
    addressLine1: "1 Main St", addressLine2: "Apt 2", city: "Springfield",
    state: "IL", postalCode: "62704", country: "USA", ssnLast4: "1234",
    maritalStatus: "single", employmentStatus: "student",
    employer: "Acme Corp", occupation: "Intern",
    notes: "Allergic to peanuts", relationshipLabel: "Daughter",
  } as const;

  // Compare the whole set in one assertion so a failure names EVERY dropped
  // column, not just the first one.
  async function readContactFields(id: string) {
    const row = await db.query.crmHouseholdContacts.findFirst({
      where: eq(crmHouseholdContacts.id, id),
    });
    return Object.fromEntries(
      Object.keys(FULL_CONTACT).map((f) => [f, row?.[f as keyof typeof row]]),
    );
  }

  it("second create omitting fields preserves every stored value", async () => {
    const first = await createCrmContact(householdId, {
      role: "dependent", firstName: "Emma", lastName: "Doe",
      familyMemberId: memberId, ...FULL_CONTACT,
    });
    // A partial refresh (name only) must not wipe advisor-entered contact info.
    await createCrmContact(householdId, {
      role: "dependent", firstName: "Emma", lastName: "Doe-Smith",
      familyMemberId: memberId,
    });
    const refreshed = await db.query.crmHouseholdContacts.findFirst({
      where: eq(crmHouseholdContacts.id, first.id),
    });
    expect(refreshed?.lastName).toBe("Doe-Smith"); // NOT NULL snapshot, always refreshed
    expect(await readContactFields(first.id)).toEqual({ ...FULL_CONTACT });
  });

  it("second create supplying previously-absent fields writes every one of them", async () => {
    // Lazy-link case: the row was seeded from family_members with nothing but a
    // name, then the advisor submits the full contact form for that member.
    const first = await createCrmContact(householdId, {
      role: "dependent", firstName: "Emma", lastName: "Doe",
      familyMemberId: memberId,
    });
    expect(first.city).toBeNull();
    expect(first.employer).toBeNull();
    expect(first.dateOfBirth).toBeNull();

    await createCrmContact(householdId, {
      role: "dependent", firstName: "Emma", lastName: "Doe",
      familyMemberId: memberId, ...FULL_CONTACT,
    });
    expect(await readContactFields(first.id)).toEqual({ ...FULL_CONTACT });
  });

  it("second create leaves the stored role alone and never collides with the one-primary index", async () => {
    // `role` is deliberately excluded from the ON CONFLICT set. Refreshing it
    // would collide with crm_contacts_one_primary_per_household here — a second
    // conflict ON CONFLICT DO UPDATE cannot resolve — and the household name
    // must keep tracking the real primary, not the submitted role.
    await createCrmContact(householdId, {
      role: "primary", firstName: "Jane", lastName: "Doe",
    });
    const linked = await createCrmContact(householdId, {
      role: "dependent", firstName: "Emma", lastName: "Doe", familyMemberId: memberId,
    });
    expect(linked.dateOfBirth).toBeNull(); // dependents get no invented DOB

    const relinked = await createCrmContact(householdId, {
      role: "primary", firstName: "Emma", lastName: "Doe", familyMemberId: memberId,
    });

    expect(relinked.id).toBe(linked.id);
    expect(relinked.role).toBe("dependent");
    // The submitted role:"primary" makes resolveContactDateOfBirth invent an
    // age-50 January-1 placeholder for the INSERT values. Because this row's
    // role stays "dependent", that placeholder must never reach the stored row:
    // the conflict path coalesces the raw submitted DOB (absent here), not the
    // resolved one. A child silently acquiring a ~50-year-old birthday would
    // corrupt education-timing projections.
    expect(relinked.dateOfBirth).toBeNull();
    const household = await db.query.crmHouseholds.findFirst({
      where: eq(crmHouseholds.id, householdId),
    });
    expect(household?.name).toBe("Jane Doe");
  });

  it("second create supplying relationshipLabel overwrites the stored value", async () => {
    const first = await createCrmContact(householdId, {
      role: "dependent", firstName: "Emma", lastName: "Doe",
      familyMemberId: memberId, relationshipLabel: "Daughter",
    });
    await createCrmContact(householdId, {
      role: "dependent", firstName: "Emma", lastName: "Doe",
      familyMemberId: memberId, relationshipLabel: "Stepdaughter",
    });
    const refreshed = await db.query.crmHouseholdContacts.findFirst({
      where: eq(crmHouseholdContacts.id, first.id),
    });
    expect(refreshed?.relationshipLabel).toBe("Stepdaughter");
  });

  it("deleting the planning family member cascades the linked contact row", async () => {
    const created = await createCrmContact(householdId, {
      role: "dependent", firstName: "Emma", lastName: "Doe",
      familyMemberId: memberId, phone: "555-0100",
    });
    await db.delete(familyMembers).where(eq(familyMembers.id, memberId));
    // Assert on the row id, not on family_member_id: a regression to
    // ON DELETE SET NULL would leave an orphan row that a familyMemberId
    // lookup would still report as "gone".
    expect(
      await db.query.crmHouseholdContacts.findFirst({
        where: eq(crmHouseholdContacts.id, created.id),
      }),
    ).toBeUndefined();
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
