import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/db";
import { clients, planSettings, crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: async () => "test-firm-res-seed",
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test" }),
}));
vi.mock("@/lib/authz", () => ({
  requireActiveSubscription: async () => undefined,
}));

import { POST } from "../route";

const FIRM = "test-firm-res-seed";

describe("POST /api/clients — residence state seed", () => {
  let caHouseholdId: string;
  let nullHouseholdId: string;
  const createdClientIds: string[] = [];

  beforeAll(async () => {
    const [ca] = await db
      .insert(crmHouseholds)
      .values({ firmId: FIRM, advisorId: "u", name: "CA HH", status: "active", state: "CA" })
      .returning();
    caHouseholdId = ca.id;
    await db.insert(crmHouseholdContacts).values({
      householdId: caHouseholdId, role: "primary", firstName: "P", lastName: "M", dateOfBirth: "1970-01-01",
    });

    const [n] = await db
      .insert(crmHouseholds)
      .values({ firmId: FIRM, advisorId: "u", name: "No State HH", status: "active" })
      .returning();
    nullHouseholdId = n.id;
    await db.insert(crmHouseholdContacts).values({
      householdId: nullHouseholdId, role: "primary", firstName: "P", lastName: "M", dateOfBirth: "1970-01-01",
    });
  });

  afterAll(async () => {
    for (const id of createdClientIds) await db.delete(clients).where(eq(clients.id, id));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.id, caHouseholdId));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.id, nullHouseholdId));
  });

  async function createClient(householdId: string): Promise<string> {
    const req = new Request("http://test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        crmHouseholdId: householdId,
        retirementAge: 65, lifeExpectancy: 95, filingStatus: "single",
      }),
    }) as unknown as Parameters<typeof POST>[0];
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    createdClientIds.push(json.id);
    return json.id;
  }

  it("seeds residenceState from the household state", async () => {
    const clientId = await createClient(caHouseholdId);
    const [ps] = await db.select().from(planSettings).where(eq(planSettings.clientId, clientId));
    expect(ps.residenceState).toBe("CA");
  });

  it("leaves residenceState null when the household has no state", async () => {
    const clientId = await createClient(nullHouseholdId);
    const [ps] = await db.select().from(planSettings).where(eq(planSettings.clientId, clientId));
    expect(ps.residenceState).toBeNull();
  });
});
