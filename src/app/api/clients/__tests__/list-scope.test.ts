import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/db";
import {
  crmHouseholds,
  crmHouseholdContacts,
  clients,
  staffAdvisorVisibility,
} from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_listscope") };
});

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
    "@clerk/nextjs/server",
  );
  return { ...actual, auth: vi.fn() };
});

import { auth } from "@clerk/nextjs/server";
import { GET } from "../route";

const ORG = "org_listscope";
const ADV_A = "adv_a";
const ADV_B = "adv_b";

function setAuth(userId: string, orgRole?: string) {
  vi.mocked(auth).mockResolvedValue({ userId, orgId: ORG, orgRole } as never);
}

function req(advisor?: string) {
  const url = advisor
    ? `http://t/api/clients?advisor=${advisor}`
    : "http://t/api/clients";
  return new NextRequest(url);
}

async function seedClient(advisorId: string, last: string) {
  const [h] = await db
    .insert(crmHouseholds)
    .values({ firmId: ORG, advisorId, name: `${last} HH` })
    .returning();
  await db.insert(crmHouseholdContacts).values({
    householdId: h.id,
    role: "primary",
    firstName: "Test",
    lastName: last,
  });
  await db.insert(clients).values({
    firmId: ORG,
    advisorId,
    crmHouseholdId: h.id,
    retirementAge: 65,
    planEndAge: 95,
    lifeExpectancy: 95,
    filingStatus: "single",
  });
}

describe("GET /api/clients visibility scoping", () => {
  beforeEach(async () => {
    await db.delete(clients).where(eq(clients.firmId, ORG));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
    await db
      .delete(staffAdvisorVisibility)
      .where(eq(staffAdvisorVisibility.firmId, ORG));
    await seedClient(ADV_A, "Apple");
    await seedClient(ADV_B, "Banana");
  });

  it("a member sees all firm clients", async () => {
    setAuth("user_member", "org:member");
    const res = await GET(req());
    const rows = await res.json();
    expect(rows.map((r: { lastName: string }) => r.lastName).sort()).toEqual([
      "Apple",
      "Banana",
    ]);
  });

  it("a planner sees only mapped advisors' clients", async () => {
    await db.insert(staffAdvisorVisibility).values({
      firmId: ORG,
      staffUserId: "user_planner",
      advisorUserId: ADV_A,
    });
    setAuth("user_planner", "org:planner");
    const res = await GET(req());
    const rows = await res.json();
    expect(rows.map((r: { lastName: string }) => r.lastName)).toEqual(["Apple"]);
  });

  it("an admin with ?advisor= narrows to that advisor's book", async () => {
    setAuth("user_admin", "org:admin");
    const res = await GET(req(ADV_A));
    const rows = await res.json();
    expect(rows.map((r: { lastName: string }) => r.lastName)).toEqual(["Apple"]);
  });

  // REGRESSION (empty-list trap): a hand-typed/bookmarked ?advisor=all must
  // mean "no narrowing" — not advisorId IN ('all'), which would silently
  // return an empty list to an admin who asked for "all clients". Proves
  // applyBookSwitcher is wired into this route via a real DB-backed request.
  it('an admin with ?advisor=all sees the FULL unnarrowed client list', async () => {
    setAuth("user_admin", "org:admin");
    const res = await GET(req("all"));
    const rows = await res.json();
    expect(rows.map((r: { lastName: string }) => r.lastName).sort()).toEqual([
      "Apple",
      "Banana",
    ]);
  });

  // SECURITY-CRITICAL: narrowToAdvisor REPLACES whatever set it's given, so a
  // non-admin's ?advisor= must be ignored entirely — never used to widen a
  // siloed/staff member's own scope to some other advisor's book.
  it("a non-admin's ?advisor= does NOT widen their scope", async () => {
    await db.insert(staffAdvisorVisibility).values({
      firmId: ORG,
      staffUserId: "user_planner",
      advisorUserId: ADV_B,
    });
    setAuth("user_planner", "org:planner");
    const res = await GET(req(ADV_A));
    const rows = await res.json();
    // Still scoped to the planner's own mapping (ADV_B), NOT ADV_A.
    expect(rows.map((r: { lastName: string }) => r.lastName)).toEqual(["Banana"]);
  });
});
