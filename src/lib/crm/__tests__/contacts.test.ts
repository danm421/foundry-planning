import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createCrmContact, deleteCrmContact } from "../contacts";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("test_org_contacts") };
});

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>("@clerk/nextjs/server");
  return {
    ...actual,
    auth: vi.fn().mockResolvedValue({ userId: "test_user", orgId: "test_org_contacts" }),
  };
});

describe("createCrmContact primary/spouse invariant", () => {
  let householdId: string;

  beforeEach(async () => {
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, "test_org_contacts"));
    const [h] = await db.insert(crmHouseholds).values({
      firmId: "test_org_contacts",
      advisorId: "test_advisor",
      name: "Test",
    }).returning();
    householdId = h.id;
  });

  it("allows one primary contact", async () => {
    await createCrmContact(householdId, {
      role: "primary", firstName: "Jane", lastName: "Doe",
    });
    const rows = await db.query.crmHouseholdContacts.findMany({ where: eq(crmHouseholdContacts.householdId, householdId) });
    expect(rows).toHaveLength(1);
  });

  it("rejects a second primary contact", async () => {
    await createCrmContact(householdId, { role: "primary", firstName: "Jane", lastName: "Doe" });
    await expect(createCrmContact(householdId, { role: "primary", firstName: "Bob", lastName: "Doe" }))
      .rejects.toThrow();
  });

  it("allows one spouse contact alongside primary", async () => {
    await createCrmContact(householdId, { role: "primary", firstName: "Jane", lastName: "Doe" });
    await createCrmContact(householdId, { role: "spouse", firstName: "Jim", lastName: "Doe" });
    const rows = await db.query.crmHouseholdContacts.findMany({ where: eq(crmHouseholdContacts.householdId, householdId) });
    expect(rows).toHaveLength(2);
  });

  it("allows multiple dependents and 'other' contacts", async () => {
    await createCrmContact(householdId, { role: "dependent", firstName: "Kid1", lastName: "Doe" });
    await createCrmContact(householdId, { role: "dependent", firstName: "Kid2", lastName: "Doe" });
    await createCrmContact(householdId, { role: "other", firstName: "Friend", lastName: "Smith" });
    const rows = await db.query.crmHouseholdContacts.findMany({ where: eq(crmHouseholdContacts.householdId, householdId) });
    expect(rows).toHaveLength(3);
  });
});

describe("household name follows contact add / remove", () => {
  let householdId: string;

  const currentName = async () =>
    (
      await db.query.crmHouseholds.findFirst({
        where: eq(crmHouseholds.id, householdId),
      })
    )?.name;

  beforeEach(async () => {
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, "test_org_contacts"));
    const [h] = await db
      .insert(crmHouseholds)
      .values({ firmId: "test_org_contacts", advisorId: "test_advisor", name: "Placeholder" })
      .returning();
    householdId = h.id;
  });

  it("updates the household name when a spouse is added", async () => {
    await createCrmContact(householdId, { role: "primary", firstName: "Jane", lastName: "Doe" });
    expect(await currentName()).toBe("Jane Doe");

    await createCrmContact(householdId, { role: "spouse", firstName: "Jim", lastName: "Doe" });
    expect(await currentName()).toBe("Jane & Jim Doe");
  });

  it("collapses the household name when a spouse is removed", async () => {
    await createCrmContact(householdId, { role: "primary", firstName: "Jane", lastName: "Doe" });
    const spouse = await createCrmContact(householdId, { role: "spouse", firstName: "Jim", lastName: "Doe" });
    expect(await currentName()).toBe("Jane & Jim Doe");

    await deleteCrmContact(spouse.id);
    expect(await currentName()).toBe("Jane Doe");
  });

  it("does not change the household name when a dependent is added", async () => {
    await createCrmContact(householdId, { role: "primary", firstName: "Jane", lastName: "Doe" });
    expect(await currentName()).toBe("Jane Doe");

    await createCrmContact(householdId, { role: "dependent", firstName: "Kid", lastName: "Doe" });
    expect(await currentName()).toBe("Jane Doe");
  });
});
