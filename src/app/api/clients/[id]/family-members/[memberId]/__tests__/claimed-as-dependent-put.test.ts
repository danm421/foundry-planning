/**
 * DB integration test for the Task 10 `claimedAsDependent` override column.
 *
 * Note: Neon dev branch cold-starts after idle; run with --testTimeout=30000.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds, familyMembers } from "@/db/schema";
import { eq } from "drizzle-orm";

// Stub auth the same way risk-tolerance-put.test.ts does — the handler goes
// through requireOrgAndUser() + requireClientEditAccess(), both of which call
// @clerk/nextjs/server's auth() under the hood.
vi.mock("@/lib/db-helpers", () => ({
  requireOrgAndUser: async () => ({ orgId: "test-firm-fm-dependent", userId: "user_test" }),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({
    userId: "user_test",
    orgId: "test-firm-fm-dependent",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  }),
}));

import { PUT } from "../route";

const FIRM = "test-firm-fm-dependent";

describe("PUT /api/clients/[id]/family-members/[memberId] — claimedAsDependent", () => {
  let householdId: string;
  let clientId: string;
  let memberId: string;

  beforeAll(async () => {
    const [hh] = await db
      .insert(crmHouseholds)
      .values({ firmId: FIRM, advisorId: "u", name: "Dependent Override Test", status: "active" })
      .returning();
    householdId = hh.id;

    const [c] = await db.insert(clients).values({
      firmId: FIRM, advisorId: "u", crmHouseholdId: householdId,
      retirementAge: 65, planEndAge: 95, lifeExpectancy: 95, filingStatus: "single",
    }).returning();
    clientId = c.id;

    const [m] = await db.insert(familyMembers).values({
      clientId,
      firstName: "Riley",
      relationship: "child",
    }).returning();
    memberId = m.id;
  });

  afterAll(async () => {
    await db.delete(familyMembers).where(eq(familyMembers.clientId, clientId));
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

  it("defaults to 'auto' on insert (schema default, not code under test)", async () => {
    const [row] = await db.select().from(familyMembers).where(eq(familyMembers.id, memberId));
    expect(row.claimedAsDependent).toBe("auto");
  });

  it("persists 'yes' and reads it back from the database — kills a mutant that drops claimedAsDependent from the .set() (drizzle silently no-ops unknown keys)", async () => {
    const res = await PUT(mockRequest({ claimedAsDependent: "yes" }), {
      params: Promise.resolve({ id: clientId, memberId }),
    });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(familyMembers).where(eq(familyMembers.id, memberId));
    expect(row.claimedAsDependent).toBe("yes");
  });

  it("persists a second, different value ('no') — kills a mutant that hardcodes the write to a fixed value regardless of the request body", async () => {
    const res = await PUT(mockRequest({ claimedAsDependent: "no" }), {
      params: Promise.resolve({ id: clientId, memberId }),
    });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(familyMembers).where(eq(familyMembers.id, memberId));
    expect(row.claimedAsDependent).toBe("no");
  });

  it("rejects an out-of-enum value with 400 and leaves the stored value unchanged — kills a mutant that drops the validation guard", async () => {
    const res = await PUT(mockRequest({ claimedAsDependent: "sometimes" }), {
      params: Promise.resolve({ id: clientId, memberId }),
    });
    expect(res.status).toBe(400);

    const [row] = await db.select().from(familyMembers).where(eq(familyMembers.id, memberId));
    // Still "no" from the previous test — an accepted invalid write would flip this.
    expect(row.claimedAsDependent).toBe("no");
  });

  it("leaves claimedAsDependent untouched when the field is omitted from the body — kills a mutant that always writes a default", async () => {
    const res = await PUT(mockRequest({ notes: "unrelated edit" }), {
      params: Promise.resolve({ id: clientId, memberId }),
    });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(familyMembers).where(eq(familyMembers.id, memberId));
    expect(row.claimedAsDependent).toBe("no");
    expect(row.notes).toBe("unrelated edit");
  });
});
