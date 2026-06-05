import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: async () => "test-firm-spouse-defaults",
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test" }),
}));
vi.mock("@/lib/authz", () => ({
  requireActiveSubscription: async () => undefined,
}));

import { POST } from "../route";

const FIRM = "test-firm-spouse-defaults";

// Some creation paths (e.g. AI import) never collect spouse retirement age /
// life expectancy, so the POST body omits them. When the CRM household has a
// spouse contact, the handler must still default them to 65 / 95 so the
// Household card never renders a blank "—" for the spouse.
describe("POST /api/clients — spouse planning defaults", () => {
  let spouseHouseholdId: string;
  let soloHouseholdId: string;
  const createdClientIds: string[] = [];

  beforeAll(async () => {
    const [spouseHh] = await db
      .insert(crmHouseholds)
      .values({ firmId: FIRM, advisorId: "u", name: "Spouse HH", status: "active" })
      .returning();
    spouseHouseholdId = spouseHh.id;
    await db.insert(crmHouseholdContacts).values([
      { householdId: spouseHouseholdId, role: "primary", firstName: "Pri", lastName: "S", dateOfBirth: "1970-01-01" },
      { householdId: spouseHouseholdId, role: "spouse", firstName: "Spo", lastName: "S", dateOfBirth: "1972-02-02" },
    ]);

    const [soloHh] = await db
      .insert(crmHouseholds)
      .values({ firmId: FIRM, advisorId: "u", name: "Solo HH", status: "active" })
      .returning();
    soloHouseholdId = soloHh.id;
    await db.insert(crmHouseholdContacts).values([
      { householdId: soloHouseholdId, role: "primary", firstName: "Solo", lastName: "P", dateOfBirth: "1980-03-03" },
    ]);
  });

  afterAll(async () => {
    for (const id of createdClientIds) {
      await db.delete(clients).where(eq(clients.id, id));
    }
    await db.delete(crmHouseholds).where(eq(crmHouseholds.id, spouseHouseholdId));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.id, soloHouseholdId));
  });

  it("defaults spouse retirement age to 65 and life expectancy to 95 when omitted (AI import)", async () => {
    const req = new Request("http://test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        crmHouseholdId: spouseHouseholdId,
        retirementAge: 65,
        lifeExpectancy: 95,
        filingStatus: "married_joint",
        // No spouse retirement / life expectancy — mirrors the AI-import path.
      }),
    }) as unknown as Parameters<typeof POST>[0];
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    createdClientIds.push(json.id);

    const row = await db.query.clients.findFirst({ where: eq(clients.id, json.id) });
    expect(row?.spouseRetirementAge).toBe(65);
    expect(row?.spouseRetirementMonth).toBe(1);
    expect(row?.spouseLifeExpectancy).toBe(95);
  });

  it("leaves spouse fields null when the household has no spouse", async () => {
    const req = new Request("http://test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        crmHouseholdId: soloHouseholdId,
        retirementAge: 65,
        lifeExpectancy: 95,
        filingStatus: "single",
      }),
    }) as unknown as Parameters<typeof POST>[0];
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    createdClientIds.push(json.id);

    const row = await db.query.clients.findFirst({ where: eq(clients.id, json.id) });
    expect(row?.spouseRetirementAge).toBeNull();
    expect(row?.spouseLifeExpectancy).toBeNull();
  });
});
