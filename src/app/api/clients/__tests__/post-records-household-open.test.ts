import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/db";
import {
  clients,
  crmHouseholds,
  crmHouseholdContacts,
  crmHouseholdViews,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";

vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: async () => "test-firm-records-open",
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_records_open" }),
}));
vi.mock("@/lib/authz", () => ({
  requireActiveSubscription: async () => undefined,
}));

import { POST } from "../route";

const FIRM = "test-firm-records-open";
const USER = "user_records_open";

// Creating a plan for a brand-new household (the "Create a new household" path,
// or a /crm/new round-trip) never clicks a row-action pill, so it never hits
// the /open endpoint. The default "Recently opened" clients view is driven by
// crm_household_views, so without recording the open here the freshly created
// household is invisible until the advisor switches to "All". POST /api/clients
// must record the open at the creation chokepoint.
describe("POST /api/clients — records the household open", () => {
  let householdId: string;
  const createdClientIds: string[] = [];

  beforeAll(async () => {
    const [hh] = await db
      .insert(crmHouseholds)
      .values({ firmId: FIRM, advisorId: "u", name: "Fresh HH", status: "prospect" })
      .returning();
    householdId = hh.id;
    await db.insert(crmHouseholdContacts).values([
      { householdId, role: "primary", firstName: "New", lastName: "Client", dateOfBirth: "1975-05-05" },
    ]);
  });

  afterAll(async () => {
    for (const id of createdClientIds) {
      await db.delete(clients).where(eq(clients.id, id));
    }
    // Deleting the household cascades its crm_household_views rows.
    await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdId));
  });

  it("upserts a crm_household_views row for the creating user", async () => {
    const req = new Request("http://test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        crmHouseholdId: householdId,
        retirementAge: 65,
        lifeExpectancy: 95,
        filingStatus: "single",
      }),
    }) as unknown as Parameters<typeof POST>[0];
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    createdClientIds.push(json.id);

    const views = await db
      .select()
      .from(crmHouseholdViews)
      .where(
        and(
          eq(crmHouseholdViews.householdId, householdId),
          eq(crmHouseholdViews.userId, USER),
        ),
      );
    expect(views).toHaveLength(1);
  });
});
