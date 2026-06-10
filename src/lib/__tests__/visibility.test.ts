import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { staffAdvisorVisibility } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  resolveVisibleAdvisorIds,
  VISIBLE_ALL,
} from "../visibility";

const FIRM = "org_vistest";

describe("resolveVisibleAdvisorIds", () => {
  beforeEach(async () => {
    await db
      .delete(staffAdvisorVisibility)
      .where(eq(staffAdvisorVisibility.firmId, FIRM));
    await db.insert(staffAdvisorVisibility).values([
      { firmId: FIRM, staffUserId: "user_ops", advisorUserId: "adv_a" },
      { firmId: FIRM, staffUserId: "user_ops", advisorUserId: "adv_b" },
    ]);
  });

  it("returns ALL for firm-wide roles", async () => {
    for (const role of ["org:owner", "org:admin", "org:member"]) {
      expect(await resolveVisibleAdvisorIds("u", role, FIRM)).toBe(VISIBLE_ALL);
    }
  });

  it("returns the mapped advisor set for staff roles", async () => {
    const visible = await resolveVisibleAdvisorIds("user_ops", "org:operations", FIRM);
    expect(visible).not.toBe(VISIBLE_ALL);
    expect([...(visible as Set<string>)].sort()).toEqual(["adv_a", "adv_b"]);
  });

  it("returns an empty set for a staff member mapped to nobody", async () => {
    const visible = await resolveVisibleAdvisorIds("user_unmapped", "org:planner", FIRM);
    expect(visible).not.toBe(VISIBLE_ALL);
    expect((visible as Set<string>).size).toBe(0);
  });
});
