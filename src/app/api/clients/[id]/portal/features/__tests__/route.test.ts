import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { eq } from "drizzle-orm";

const FIRM = "test-firm-portal-features";

// Same shape as the sibling client PUT tests: requireClientEditAccess reads
// Clerk's org, and is_founder bypasses the subscription gate.
vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: async () => "test-firm-portal-features",
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({
    userId: "user_test",
    orgId: "test-firm-portal-features",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  }),
}));

import { PUT } from "../route";

describe("PUT /api/clients/[id]/portal/features", () => {
  let householdId: string;
  let clientId: string;

  beforeAll(async () => {
    const [hh] = await db
      .insert(crmHouseholds)
      .values({ firmId: FIRM, advisorId: "u", name: "Portal Features Test", status: "active" })
      .returning();
    householdId = hh.id;
    await db.insert(crmHouseholdContacts).values([
      { householdId, role: "primary", firstName: "Pat", lastName: "P", dateOfBirth: "1970-01-01" },
    ]);
    const [c] = await db
      .insert(clients)
      .values({
        firmId: FIRM,
        advisorId: "u",
        crmHouseholdId: householdId,
        retirementAge: 65,
        planEndAge: 95,
        lifeExpectancy: 95,
        filingStatus: "single",
      })
      .returning();
    clientId = c.id;
  });

  afterAll(async () => {
    await db.delete(clients).where(eq(clients.id, clientId));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdId));
  });

  function req(body: unknown) {
    return new Request("http://test", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as unknown as Parameters<typeof PUT>[0];
  }

  async function row() {
    const [c] = await db
      .select({
        investments: clients.portalInvestmentsEnabled,
        budget: clients.portalBudgetEnabled,
        documents: clients.portalDocumentsEnabled,
        calculators: clients.portalCalculatorsEnabled,
      })
      .from(clients)
      .where(eq(clients.id, clientId));
    return c;
  }

  it("defaults every section to on", async () => {
    expect(await row()).toEqual({
      investments: true,
      budget: true,
      documents: true,
      calculators: true,
    });
  });

  // The regression this exists for: an empty SET clause. Drizzle silently drops
  // an unknown key, so a wrong column name here 500s on "update clients set
  // where id = $1" rather than writing the wrong column.
  it("writes only the named feature's column", async () => {
    const res = await PUT(req({ feature: "budget", enabled: false }), {
      params: Promise.resolve({ id: clientId }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, feature: "budget", enabled: false });
    expect(await row()).toEqual({
      investments: true,
      budget: false,
      documents: true,
      calculators: true,
    });
  });

  it("switches each of the four independently, and back on", async () => {
    for (const feature of ["investments", "documents", "calculators"] as const) {
      const res = await PUT(req({ feature, enabled: false }), {
        params: Promise.resolve({ id: clientId }),
      });
      expect(res.status).toBe(200);
    }
    expect(await row()).toEqual({
      investments: false,
      budget: false,
      documents: false,
      calculators: false,
    });

    const res = await PUT(req({ feature: "budget", enabled: true }), {
      params: Promise.resolve({ id: clientId }),
    });
    expect(res.status).toBe(200);
    expect(await row()).toEqual({
      investments: false,
      budget: true,
      documents: false,
      calculators: false,
    });
  });

  it("rejects a feature key that is not one of the four", async () => {
    const before = await row();
    for (const feature of ["portalEditEnabled", "organizer", "firmId", "", null, 7]) {
      const res = await PUT(req({ feature, enabled: false }), {
        params: Promise.resolve({ id: clientId }),
      });
      expect(res.status).toBe(400);
    }
    expect(await row()).toEqual(before);
  });

  it("rejects a non-boolean enabled", async () => {
    const before = await row();
    for (const enabled of ["false", 0, null, undefined]) {
      const res = await PUT(req({ feature: "budget", enabled }), {
        params: Promise.resolve({ id: clientId }),
      });
      expect(res.status).toBe(400);
    }
    expect(await row()).toEqual(before);
  });
});
