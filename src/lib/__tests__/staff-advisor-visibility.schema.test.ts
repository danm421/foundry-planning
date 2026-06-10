import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { staffAdvisorVisibility } from "@/db/schema";
import { and, eq } from "drizzle-orm";

const FIRM = "org_savtest";

describe("staff_advisor_visibility schema", () => {
  beforeEach(async () => {
    await db
      .delete(staffAdvisorVisibility)
      .where(eq(staffAdvisorVisibility.firmId, FIRM));
  });

  it("stores and reads a staff→advisor edge", async () => {
    await db.insert(staffAdvisorVisibility).values({
      firmId: FIRM,
      staffUserId: "user_ops",
      advisorUserId: "user_adv",
      createdBy: "user_admin",
    });
    const rows = await db
      .select()
      .from(staffAdvisorVisibility)
      .where(
        and(
          eq(staffAdvisorVisibility.firmId, FIRM),
          eq(staffAdvisorVisibility.staffUserId, "user_ops"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].advisorUserId).toBe("user_adv");
  });
});
