import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createCrmContact, deleteCrmContact, updateCrmContact } from "../contacts";
import * as activityModule from "../activity";
import * as auditModule from "@/lib/audit";
import type { FieldChange } from "@/lib/audit/types";

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

// Task 5: updateCrmContact builds a real field-level diff via buildFieldChanges
// and only writes an activity row when something actually changed — and never
// lets a sensitive field's raw value reach the written metadata. Nothing above
// asserts on recordActivity's call args, so these pin the call-site wiring
// down directly (spying on the real activity/audit modules rather than
// mocking `db`, matching the fixture style used elsewhere in this file).
describe("updateCrmContact activity wiring", () => {
  let householdId: string;
  let contactId: string;

  beforeEach(async () => {
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, "test_org_contacts"));
    const [h] = await db
      .insert(crmHouseholds)
      .values({ firmId: "test_org_contacts", advisorId: "test_advisor", name: "Placeholder" })
      .returning();
    householdId = h.id;
    const created = await createCrmContact(householdId, {
      role: "primary", firstName: "Jane", lastName: "Doe",
      email: "jane@old.com", ssnLast4: "1234",
    });
    contactId = created.id;
  });

  it("a real field change writes an activity row carrying the diff", async () => {
    const activitySpy = vi.spyOn(activityModule, "recordActivity");
    try {
      await updateCrmContact(contactId, { email: "jane@new.com" });

      expect(activitySpy).toHaveBeenCalledTimes(1);
      const [payload] = activitySpy.mock.calls[0]!;
      const metadata = payload.metadata as { contactId: string; changes: FieldChange[] };
      expect(metadata.contactId).toBe(contactId);
      expect(metadata.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "email", from: "jane@old.com", to: "jane@new.com" }),
        ]),
      );
    } finally {
      activitySpy.mockRestore();
    }
  });

  it("a no-op patch writes no activity row, while the audit log still fires", async () => {
    const activitySpy = vi.spyOn(activityModule, "recordActivity");
    const auditSpy = vi.spyOn(auditModule, "recordAudit");
    try {
      await updateCrmContact(contactId, { email: "jane@old.com" });

      expect(activitySpy).not.toHaveBeenCalled();
      expect(auditSpy).toHaveBeenCalledTimes(1);
    } finally {
      activitySpy.mockRestore();
      auditSpy.mockRestore();
    }
  });

  it("redacts a sensitive field change and never leaks the raw value into metadata", async () => {
    const activitySpy = vi.spyOn(activityModule, "recordActivity");
    try {
      await updateCrmContact(contactId, { ssnLast4: "9999" });

      expect(activitySpy).toHaveBeenCalledTimes(1);
      const [payload] = activitySpy.mock.calls[0]!;
      const metadata = payload.metadata as { contactId: string; changes: FieldChange[] };
      const ssnChange = metadata.changes.find((c) => c.field === "ssnLast4");
      expect(ssnChange).toMatchObject({ redacted: true, from: null, to: null });

      // The pin: the security constraint is "raw value never reaches the
      // written metadata" — not just "a redacted flag exists somewhere".
      const serialized = JSON.stringify(metadata);
      expect(serialized).not.toContain("9999"); // new SSN
      expect(serialized).not.toContain("1234"); // old SSN
    } finally {
      activitySpy.mockRestore();
    }
  });
});
