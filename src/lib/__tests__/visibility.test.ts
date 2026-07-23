import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { firms, staffAdvisorVisibility } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  resolveVisibleAdvisorIds,
  VISIBLE_ALL,
  narrowToAdvisor,
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

const SILO = "org_silo_test";

describe("resolveVisibleAdvisorIds — book siloing", () => {
  beforeEach(async () => {
    await db.delete(staffAdvisorVisibility).where(eq(staffAdvisorVisibility.firmId, SILO));
    await db.delete(firms).where(eq(firms.firmId, SILO));
  });

  it("admin sees ALL even when siloed", async () => {
    await db.insert(firms).values({ firmId: SILO, bookSiloEnabled: true });
    expect(await resolveVisibleAdvisorIds("u_admin", "org:admin", SILO)).toBe(VISIBLE_ALL);
  });

  it("advisor sees ALL when firm is NOT siloed (legacy)", async () => {
    await db.insert(firms).values({ firmId: SILO, bookSiloEnabled: false });
    expect(await resolveVisibleAdvisorIds("u_adv", "org:member", SILO)).toBe(VISIBLE_ALL);
  });

  it("advisor sees only self when siloed (shares handled separately)", async () => {
    await db.insert(firms).values({ firmId: SILO, bookSiloEnabled: true });
    const v = await resolveVisibleAdvisorIds("u_adv", "org:member", SILO);
    expect(v).not.toBe(VISIBLE_ALL);
    expect([...(v as Set<string>)].sort()).toEqual(["u_adv"]);
  });

  it("siloed advisor with no userId sees nothing", async () => {
    await db.insert(firms).values({ firmId: SILO, bookSiloEnabled: true });
    const v = await resolveVisibleAdvisorIds("", "org:member", SILO);
    expect([...(v as Set<string>)]).toEqual([]);
  });

  it("narrowToAdvisor collapses VISIBLE_ALL to a single advisor", () => {
    const n = narrowToAdvisor(VISIBLE_ALL, "u_x");
    expect([...(n as Set<string>)]).toEqual(["u_x"]);
  });
});
