import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { crmHouseholds, staffAdvisorVisibility } from "@/db/schema";
import { visibleHouseholdConditions } from "../scope";

const ORG = "org_homescope";
const ADV_A = "adv_a";
const ADV_B = "adv_b";

async function namesFor(
  conditions: Awaited<ReturnType<typeof visibleHouseholdConditions>>,
) {
  const rows = await db.query.crmHouseholds.findMany({ where: and(...conditions) });
  return rows.map((r) => r.name).sort();
}

describe("visibleHouseholdConditions — admin viewAsAdvisorId narrowing", () => {
  beforeEach(async () => {
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
    await db
      .delete(staffAdvisorVisibility)
      .where(eq(staffAdvisorVisibility.firmId, ORG));
    await db.insert(crmHouseholds).values([
      { firmId: ORG, advisorId: ADV_A, name: "A HH", status: "active" },
      { firmId: ORG, advisorId: ADV_B, name: "B HH", status: "active" },
    ]);
  });

  it("an admin with no viewAsAdvisorId sees all firm households", async () => {
    const conditions = await visibleHouseholdConditions(ORG, "user_admin", "org:admin");
    expect(await namesFor(conditions)).toEqual(["A HH", "B HH"]);
  });

  it("an admin with viewAsAdvisorId narrows to that advisor's households", async () => {
    const conditions = await visibleHouseholdConditions(
      ORG,
      "user_admin",
      "org:admin",
      ADV_A,
    );
    expect(await namesFor(conditions)).toEqual(["A HH"]);
  });

  // SECURITY-CRITICAL: narrowToAdvisor REPLACES whatever set it's given, so a
  // non-admin's viewAsAdvisorId must be ignored — never used to widen a staff
  // member's own mapped scope to some other advisor's book.
  it("a non-admin's viewAsAdvisorId does NOT widen their scope", async () => {
    await db.insert(staffAdvisorVisibility).values({
      firmId: ORG,
      staffUserId: "user_ops",
      advisorUserId: ADV_B,
    });
    const conditions = await visibleHouseholdConditions(
      ORG,
      "user_ops",
      "org:operations",
      ADV_A,
    );
    expect(await namesFor(conditions)).toEqual(["B HH"]);
  });
});
