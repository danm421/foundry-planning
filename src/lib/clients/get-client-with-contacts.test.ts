import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/db";
import { crmHouseholds, crmHouseholdContacts, clients } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getClientWithContacts } from "./get-client-with-contacts";

const FIRM = "test-firm-contacts-helper";

describe("getClientWithContacts", () => {
  let householdId: string;
  let clientId: string;

  beforeAll(async () => {
    const [hh] = await db
      .insert(crmHouseholds)
      .values({ firmId: FIRM, advisorId: "user_test", name: "Test HH", status: "active" })
      .returning();
    householdId = hh.id;

    await db.insert(crmHouseholdContacts).values([
      {
        householdId,
        role: "primary",
        firstName: "Pat", lastName: "Primary",
        dateOfBirth: "1970-01-01",
        email: "pat@example.com", phone: "555-0001", mobile: "555-1001",
        addressLine1: "1 Main", city: "Springfield", state: "IL", postalCode: "62701", country: "US",
      },
      {
        householdId,
        role: "spouse",
        firstName: "Sam", lastName: "Spouse",
        dateOfBirth: "1972-02-02",
        email: "sam@example.com", phone: "555-0002",
        addressLine1: "1 Main", city: "Springfield", state: "IL", postalCode: "62701", country: "US",
      },
    ]);

    const [c] = await db
      .insert(clients)
      .values({
        firmId: FIRM, advisorId: "user_test", crmHouseholdId: householdId,
        retirementAge: 65, planEndAge: 95, lifeExpectancy: 95, filingStatus: "married_joint",
      })
      .returning();
    clientId = c.id;
  });

  afterAll(async () => {
    await db.delete(clients).where(eq(clients.id, clientId));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdId));
  });

  it("returns flat client + primary + spouse contact fields", async () => {
    const row = await getClientWithContacts(clientId, FIRM);
    expect(row).not.toBeNull();
    expect(row!.id).toBe(clientId);
    expect(row!.email).toBe("pat@example.com");
    expect(row!.phone).toBe("555-0001");
    expect(row!.mobile).toBe("555-1001");
    expect(row!.addressLine1).toBe("1 Main");
    expect(row!.city).toBe("Springfield");
    expect(row!.spouseEmail).toBe("sam@example.com");
    expect(row!.spousePhone).toBe("555-0002");
    expect(row!.spouseMobile).toBeNull();
  });

  it("returns null spouse fields when household has no spouse contact", async () => {
    await db.delete(crmHouseholdContacts).where(
      eq(crmHouseholdContacts.householdId, householdId),
    );
    await db.insert(crmHouseholdContacts).values({
      householdId, role: "primary",
      firstName: "Pat", lastName: "Primary",
      dateOfBirth: "1970-01-01",
      email: "pat@example.com",
    });

    const row = await getClientWithContacts(clientId, FIRM);
    expect(row!.email).toBe("pat@example.com");
    expect(row!.spouseEmail).toBeNull();
    expect(row!.spousePhone).toBeNull();
    expect(row!.spouseAddressLine1).toBeNull();
  });

  it("returns null when client is in a different firm (org scoping)", async () => {
    const row = await getClientWithContacts(clientId, "other-firm");
    expect(row).toBeNull();
  });
});
