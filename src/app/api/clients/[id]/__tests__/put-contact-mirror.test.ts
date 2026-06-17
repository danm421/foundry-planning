import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { eq, and } from "drizzle-orm";

// Stub auth — the handler calls requireOrgId() which reads Clerk org.
vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: async () => "test-firm-put-mirror",
}));

// Phase 1b: routes gate via verifyClientAccess → auth() from @clerk/nextjs/server.
// Mock it so the staff-scope check is a no-op (undefined orgRole ⇒ non-staff ⇒
// access turns purely on the firm-scoped clients query the test already drives).
vi.mock("@clerk/nextjs/server", () => ({
  // orgId = FIRM (inlined — vi.mock is hoisted) so the real requireClientAccess
  // own-firm path (`client.firmId === orgId`) matches the seeded client's firm.
  auth: vi.fn().mockResolvedValue({ userId: "user_test", orgId: "test-firm-put-mirror" }),
}));

import { PUT } from "../route";

const FIRM = "test-firm-put-mirror";

describe("PUT /api/clients/[id] — contact mirror", () => {
  let householdId: string;
  let clientId: string;

  beforeAll(async () => {
    const [hh] = await db
      .insert(crmHouseholds)
      .values({ firmId: FIRM, advisorId: "u", name: "PM Test", status: "active" })
      .returning();
    householdId = hh.id;
    await db.insert(crmHouseholdContacts).values([
      { householdId, role: "primary", firstName: "Pat", lastName: "P", dateOfBirth: "1970-01-01" },
      { householdId, role: "spouse",  firstName: "Sam", lastName: "P", dateOfBirth: "1972-02-02" },
    ]);
    const [c] = await db.insert(clients).values({
      firmId: FIRM, advisorId: "u", crmHouseholdId: householdId,
      retirementAge: 65, planEndAge: 95, lifeExpectancy: 95, filingStatus: "married_joint",
    }).returning();
    clientId = c.id;
  });

  afterAll(async () => {
    await db.delete(clients).where(eq(clients.id, clientId));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdId));
  });

  function mockRequest(body: unknown) {
    return new Request("http://test", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as unknown as Parameters<typeof PUT>[0];
  }

  it("mirrors email + phone + mobile + address block to primary contact", async () => {
    const res = await PUT(mockRequest({
      email: "pat-new@example.com",
      phone: "555-1111",
      mobile: "555-2222",
      addressLine1: "100 Pine",
      addressLine2: "Apt 3",
      city: "Madison",
      state: "WI",
      postalCode: "53703",
      country: "US",
    }), { params: Promise.resolve({ id: clientId }) });
    expect(res.status).toBe(200);

    const [p] = await db.select().from(crmHouseholdContacts).where(and(
      eq(crmHouseholdContacts.householdId, householdId),
      eq(crmHouseholdContacts.role, "primary"),
    ));
    expect(p.email).toBe("pat-new@example.com");
    expect(p.phone).toBe("555-1111");
    expect(p.mobile).toBe("555-2222");
    expect(p.addressLine1).toBe("100 Pine");
    expect(p.addressLine2).toBe("Apt 3");
    expect(p.city).toBe("Madison");
    expect(p.state).toBe("WI");
    expect(p.postalCode).toBe("53703");
    expect(p.country).toBe("US");
  });

  it("mirrors spouse fields to spouse contact only", async () => {
    await PUT(mockRequest({
      spouseEmail: "sam-new@example.com",
      spousePhone: "555-3333",
      spouseAddressLine1: "200 Oak",
      spouseCity: "Madison",
    }), { params: Promise.resolve({ id: clientId }) });

    const [p, s] = await Promise.all([
      db.select().from(crmHouseholdContacts).where(and(
        eq(crmHouseholdContacts.householdId, householdId),
        eq(crmHouseholdContacts.role, "primary"),
      )).then(r => r[0]),
      db.select().from(crmHouseholdContacts).where(and(
        eq(crmHouseholdContacts.householdId, householdId),
        eq(crmHouseholdContacts.role, "spouse"),
      )).then(r => r[0]),
    ]);
    expect(s.email).toBe("sam-new@example.com");
    expect(s.phone).toBe("555-3333");
    expect(s.addressLine1).toBe("200 Oak");
    // Previous primary writes from earlier test should still be there.
    expect(p.email).toBe("pat-new@example.com");
  });

  it("does not touch non-contact CRM fields", async () => {
    await PUT(mockRequest({ email: "pat-third@example.com" }), { params: Promise.resolve({ id: clientId }) });
    const [p] = await db.select().from(crmHouseholdContacts).where(and(
      eq(crmHouseholdContacts.householdId, householdId),
      eq(crmHouseholdContacts.role, "primary"),
    ));
    expect(p.firstName).toBe("Pat");      // unchanged
    expect(p.lastName).toBe("P");          // unchanged
    expect(p.dateOfBirth).toBe("1970-01-01");
    expect(p.email).toBe("pat-third@example.com");
  });
});
