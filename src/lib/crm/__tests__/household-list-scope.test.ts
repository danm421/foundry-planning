import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, crmHouseholdViews, staffAdvisorVisibility } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_hhscope") };
});

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
    "@clerk/nextjs/server",
  );
  return { ...actual, auth: vi.fn() };
});

import { auth } from "@clerk/nextjs/server";
import { listCrmHouseholds, listRecentlyOpenedHouseholds } from "../households";

const ORG = "org_hhscope";
const ADV_A = "adv_a";
const ADV_B = "adv_b";

function setAuth(userId: string, orgRole?: string) {
  vi.mocked(auth).mockResolvedValue({ userId, orgId: ORG, orgRole } as never);
}

describe("listCrmHouseholds visibility scoping", () => {
  beforeEach(async () => {
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
    await db
      .delete(staffAdvisorVisibility)
      .where(eq(staffAdvisorVisibility.firmId, ORG));
    await db.insert(crmHouseholds).values([
      { firmId: ORG, advisorId: ADV_A, name: "A HH" },
      { firmId: ORG, advisorId: ADV_B, name: "B HH" },
    ]);
  });

  it("a member sees all firm households", async () => {
    setAuth("user_member", "org:member");
    const rows = await listCrmHouseholds();
    expect(rows.map((r) => r.name).sort()).toEqual(["A HH", "B HH"]);
  });

  it("an operations member sees only mapped advisors' households", async () => {
    await db.insert(staffAdvisorVisibility).values({
      firmId: ORG,
      staffUserId: "user_ops",
      advisorUserId: ADV_B,
    });
    setAuth("user_ops", "org:operations");
    const rows = await listCrmHouseholds();
    expect(rows.map((r) => r.name)).toEqual(["B HH"]);
  });

  it("a staff member mapped to nobody sees nothing", async () => {
    setAuth("user_ops_unmapped", "org:operations");
    const rows = await listCrmHouseholds();
    expect(rows).toHaveLength(0);
  });

  it("an admin with viewAsAdvisorId sees only that advisor's households", async () => {
    setAuth("user_admin", "org:admin");
    const rows = await listCrmHouseholds({ viewAsAdvisorId: ADV_A });
    expect(rows.map((r) => r.name)).toEqual(["A HH"]);
  });

  // SECURITY-CRITICAL: narrowToAdvisor replaces (not narrows) whatever set it's
  // given, so a non-admin's viewAsAdvisorId MUST be ignored — never widen a
  // siloed/staff member's scope to some other advisor the client asked for.
  it("a non-admin's viewAsAdvisorId does NOT widen their scope", async () => {
    await db.insert(staffAdvisorVisibility).values({
      firmId: ORG,
      staffUserId: "user_ops",
      advisorUserId: ADV_B,
    });
    setAuth("user_ops", "org:operations");
    const rows = await listCrmHouseholds({ viewAsAdvisorId: ADV_A });
    // Still scoped to the staff member's own mapping (ADV_B), NOT ADV_A.
    expect(rows.map((r) => r.name)).toEqual(["B HH"]);
  });
});

describe("listRecentlyOpenedHouseholds visibility scoping", () => {
  let hhA: string;
  let hhB: string;

  beforeEach(async () => {
    await db.delete(crmHouseholdViews).where(eq(crmHouseholdViews.firmId, ORG));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
    await db
      .delete(staffAdvisorVisibility)
      .where(eq(staffAdvisorVisibility.firmId, ORG));
    const [a, b] = await db
      .insert(crmHouseholds)
      .values([
        { firmId: ORG, advisorId: ADV_A, name: "A HH" },
        { firmId: ORG, advisorId: ADV_B, name: "B HH" },
      ])
      .returning();
    hhA = a.id;
    hhB = b.id;
    // Both households are "recently opened" by each caller below — the views
    // table imposes no advisor restriction on its own, so any narrowing in
    // the assertions below must come from the advisor-scope gate under test,
    // not from which households happen to have been opened.
    await db.insert(crmHouseholdViews).values([
      { firmId: ORG, userId: "user_admin", householdId: hhA },
      { firmId: ORG, userId: "user_admin", householdId: hhB },
      { firmId: ORG, userId: "user_ops", householdId: hhA },
      { firmId: ORG, userId: "user_ops", householdId: hhB },
    ]);
  });

  it("an admin with viewAsAdvisorId sees only that advisor's recently-opened households", async () => {
    setAuth("user_admin", "org:admin");
    const rows = await listRecentlyOpenedHouseholds({
      userId: "user_admin",
      viewAsAdvisorId: ADV_A,
    });
    expect(rows.map((r) => r.name)).toEqual(["A HH"]);
  });

  // SECURITY-CRITICAL: same gate as listCrmHouseholds — a non-admin's
  // viewAsAdvisorId must be ignored, never used to widen their own scope.
  it("a non-admin's viewAsAdvisorId does NOT widen their recently-opened scope", async () => {
    await db.insert(staffAdvisorVisibility).values({
      firmId: ORG,
      staffUserId: "user_ops",
      advisorUserId: ADV_B,
    });
    setAuth("user_ops", "org:operations");
    const rows = await listRecentlyOpenedHouseholds({
      userId: "user_ops",
      viewAsAdvisorId: ADV_A,
    });
    // Still scoped to the staff member's own mapping (ADV_B), NOT ADV_A —
    // even though ADV_A's household was also "recently opened" by this user.
    expect(rows.map((r) => r.name)).toEqual(["B HH"]);
  });
});
