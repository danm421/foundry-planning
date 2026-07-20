import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createCrmHousehold, updateCrmHousehold } from "../households";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("test_org_hh_create") };
});

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>("@clerk/nextjs/server");
  return {
    ...actual,
    auth: vi.fn().mockResolvedValue({ userId: "test_user", orgId: "test_org_hh_create" }),
  };
});

describe("createCrmHousehold with inline contacts", () => {
  beforeEach(async () => {
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, "test_org_hh_create"));
  });

  it("creates the household plus primary and spouse contacts atomically", async () => {
    const household = await createCrmHousehold({
      name: "John & Jane Smith",
      status: "prospect",
      advisorId: "test_advisor",
      contacts: [
        { role: "primary", firstName: "John", lastName: "Smith" },
        { role: "spouse", firstName: "Jane", lastName: "Smith" },
      ],
    });

    expect(household.name).toBe("John & Jane Smith");
    expect(household.status).toBe("prospect");

    const contacts = await db.query.crmHouseholdContacts.findMany({
      where: eq(crmHouseholdContacts.householdId, household.id),
    });
    expect(contacts).toHaveLength(2);
    expect(contacts.map((c) => c.role).sort()).toEqual(["primary", "spouse"]);
  });

  it("creates a household with just a primary contact", async () => {
    const household = await createCrmHousehold({
      name: "John Smith",
      status: "prospect",
      advisorId: "test_advisor",
      contacts: [{ role: "primary", firstName: "John", lastName: "Smith", dateOfBirth: "1965-04-02" }],
    });
    const contacts = await db.query.crmHouseholdContacts.findMany({
      where: eq(crmHouseholdContacts.householdId, household.id),
    });
    expect(contacts).toHaveLength(1);
    expect(contacts[0].dateOfBirth).toBe("1965-04-02");
  });

  it("rolls back the household when a contact insert violates the unique-role constraint", async () => {
    await expect(
      createCrmHousehold({
        name: "Bad Household",
        status: "prospect",
        advisorId: "test_advisor",
        contacts: [
          { role: "primary", firstName: "John", lastName: "Smith" },
          { role: "primary", firstName: "Bob", lastName: "Smith" },
        ],
      }),
    ).rejects.toThrow();

    const households = await db.query.crmHouseholds.findMany({
      where: eq(crmHouseholds.firmId, "test_org_hh_create"),
    });
    expect(households).toHaveLength(0);
  });

  it("still works with no contacts (backward compatible)", async () => {
    const household = await createCrmHousehold({
      name: "Empty Household",
      status: "prospect",
      advisorId: "test_advisor",
    });
    expect(household.name).toBe("Empty Household");
    const contacts = await db.query.crmHouseholdContacts.findMany({
      where: eq(crmHouseholdContacts.householdId, household.id),
    });
    expect(contacts).toHaveLength(0);
  });

  it("persists the household residence state and seeds the primary contact state", async () => {
    const household = await createCrmHousehold({
      name: "Stateful Household",
      status: "prospect",
      advisorId: "test_advisor",
      state: "CA",
      contacts: [
        { role: "primary", firstName: "John", lastName: "Smith" },
        { role: "spouse", firstName: "Jane", lastName: "Smith" },
      ],
    });

    expect(household.state).toBe("CA");

    const contacts = await db.query.crmHouseholdContacts.findMany({
      where: eq(crmHouseholdContacts.householdId, household.id),
    });
    const primary = contacts.find((c) => c.role === "primary");
    const spouse = contacts.find((c) => c.role === "spouse");
    expect(primary?.state).toBe("CA");
    expect(spouse?.state).toBeNull();
  });
});

describe("household name lock", () => {
  it("persists nameIsCustom on create", async () => {
    const h = await createCrmHousehold({
      name: "Smith Family Trust",
      status: "active",
      advisorId: "test_advisor",
      nameIsCustom: true,
      contacts: [{ role: "primary", firstName: "John", lastName: "Smith" }],
    });
    expect(h.nameIsCustom).toBe(true);
    expect(h.name).toBe("Smith Family Trust");
  });

  it("defaults nameIsCustom to false", async () => {
    const h = await createCrmHousehold({
      name: "John Smith",
      status: "active",
      advisorId: "test_advisor",
      contacts: [{ role: "primary", firstName: "John", lastName: "Smith" }],
    });
    expect(h.nameIsCustom).toBe(false);
  });

  it("ignores a client-supplied name when unlocking, and re-derives", async () => {
    const h = await createCrmHousehold({
      name: "Smith Family Trust",
      status: "active",
      advisorId: "test_advisor",
      nameIsCustom: true,
      contacts: [{ role: "primary", firstName: "John", lastName: "Smith" }],
    });

    // Client tries to unlock AND set an arbitrary name. The name must lose.
    const updated = await updateCrmHousehold(h.id, {
      name: "Whatever The Client Typed",
      nameIsCustom: false,
    });

    expect(updated.nameIsCustom).toBe(false);
    expect(updated.name).toBe("John Smith");
  });

  it("honors a custom name when locking", async () => {
    const h = await createCrmHousehold({
      name: "John Smith",
      status: "active",
      advisorId: "test_advisor",
      contacts: [{ role: "primary", firstName: "John", lastName: "Smith" }],
    });

    const updated = await updateCrmHousehold(h.id, {
      name: "Smith Family Trust",
      nameIsCustom: true,
    });

    expect(updated.name).toBe("Smith Family Trust");
  });

  it("leaves the name alone on a status-only patch", async () => {
    const h = await createCrmHousehold({
      name: "Smith Family Trust",
      status: "active",
      advisorId: "test_advisor",
      nameIsCustom: true,
      contacts: [{ role: "primary", firstName: "John", lastName: "Smith" }],
    });

    const updated = await updateCrmHousehold(h.id, { status: "inactive" });

    expect(updated.name).toBe("Smith Family Trust");
    expect(updated.status).toBe("inactive");
  });
});
