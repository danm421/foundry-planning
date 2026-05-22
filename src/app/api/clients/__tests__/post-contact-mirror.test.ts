import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { eq, and } from "drizzle-orm";

vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: async () => "test-firm-post-mirror",
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test" }),
}));
vi.mock("@/lib/authz", () => ({
  requireActiveSubscription: async () => undefined,
}));

import { POST } from "../route";

const FIRM = "test-firm-post-mirror";

describe("POST /api/clients — contact mirror", () => {
  let householdId: string;
  let createdClientId: string | null = null;

  beforeAll(async () => {
    const [hh] = await db
      .insert(crmHouseholds)
      .values({ firmId: FIRM, advisorId: "u", name: "PC Test", status: "active" })
      .returning();
    householdId = hh.id;
    await db.insert(crmHouseholdContacts).values([
      { householdId, role: "primary", firstName: "Pri", lastName: "M", dateOfBirth: "1970-01-01" },
      { householdId, role: "spouse",  firstName: "Spo", lastName: "M", dateOfBirth: "1972-02-02" },
    ]);
  });

  afterAll(async () => {
    if (createdClientId) await db.delete(clients).where(eq(clients.id, createdClientId));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdId));
  });

  it("creates client and mirrors primary + spouse contact info to CRM", async () => {
    const req = new Request("http://test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        crmHouseholdId: householdId,
        retirementAge: 65, lifeExpectancy: 95, filingStatus: "married_joint",
        spouseRetirementAge: 65, spouseLifeExpectancy: 95,
        email: "pri@example.com", phone: "555-0100", addressLine1: "1 A St",
        spouseEmail: "spo@example.com", spousePhone: "555-0200", spouseAddressLine1: "1 A St",
      }),
    }) as unknown as Parameters<typeof POST>[0];
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    createdClientId = json.id;

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
    expect(p.email).toBe("pri@example.com");
    expect(p.phone).toBe("555-0100");
    expect(p.addressLine1).toBe("1 A St");
    expect(s.email).toBe("spo@example.com");
    expect(s.phone).toBe("555-0200");
  });
});
