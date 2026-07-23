import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { eq } from "drizzle-orm";

// Stub auth — the handler calls requireOrgId() which reads Clerk org.
vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: async () => "test-firm-risk-tol",
}));

// Phase 1b: routes gate via verifyClientAccess → auth() from @clerk/nextjs/server.
// Mock it so the staff-scope check is a no-op (undefined orgRole ⇒ non-staff ⇒
// access turns purely on the firm-scoped clients query the test already drives).
// Task 17f1: sessionClaims.org_public_metadata.is_founder bypasses the subscription
// gate so requireActiveSubscriptionForFirm passes without a live Clerk API call.
vi.mock("@clerk/nextjs/server", () => ({
  // orgId = FIRM (inlined — vi.mock is hoisted) so the real requireClientEditAccess
  // own-firm path (`client.firmId === orgId`) matches the seeded client's firm.
  auth: vi.fn().mockResolvedValue({
    userId: "user_test",
    orgId: "test-firm-risk-tol",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  }),
}));

import { PUT } from "../route";

const FIRM = "test-firm-risk-tol";

describe("PUT /api/clients/[id] — riskTolerance", () => {
  let householdId: string;
  let clientId: string;

  beforeAll(async () => {
    const [hh] = await db
      .insert(crmHouseholds)
      .values({ firmId: FIRM, advisorId: "u", name: "Risk Tol Test", status: "active" })
      .returning();
    householdId = hh.id;
    await db.insert(crmHouseholdContacts).values([
      { householdId, role: "primary", firstName: "Pat", lastName: "P", dateOfBirth: "1970-01-01" },
    ]);
    const [c] = await db.insert(clients).values({
      firmId: FIRM, advisorId: "u", crmHouseholdId: householdId,
      retirementAge: 65, planEndAge: 95, lifeExpectancy: 95, filingStatus: "single",
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

  it("accepts a valid riskTolerance and rejects an out-of-enum value", async () => {
    let res = await PUT(mockRequest({ riskTolerance: "moderate" }), {
      params: Promise.resolve({ id: clientId }),
    });
    expect(res.status).toBe(200);
    const [c] = await db.select().from(clients).where(eq(clients.id, clientId));
    expect(c.riskTolerance).toBe("moderate");

    res = await PUT(mockRequest({ riskTolerance: "balanced" }), {
      params: Promise.resolve({ id: clientId }),
    });
    expect(res.status).toBe(400);
  });
});
