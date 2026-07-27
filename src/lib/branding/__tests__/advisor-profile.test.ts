import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { advisorProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  getAdvisorProfile,
  upsertAdvisorProfile,
  setAdvisorBrandingEnabled,
  listAdvisorProfiles,
} from "../advisor-profile";

const FIRM = "org_advprof_test";
const OTHER_FIRM = "org_advprof_test_other";

describe("advisor-profile", () => {
  beforeEach(async () => {
    await db.delete(advisorProfiles).where(eq(advisorProfiles.firmId, FIRM));
  });

  it("returns null when absent", async () => {
    expect(await getAdvisorProfile(FIRM, "adv_a")).toBeNull();
  });

  it("upsert creates then updates the same row", async () => {
    await upsertAdvisorProfile(FIRM, "adv_a", { brandName: "Summit" }, "adv_a");
    await upsertAdvisorProfile(FIRM, "adv_a", { primaryColor: "#123456" }, "adv_a");
    const rows = await db.select().from(advisorProfiles).where(eq(advisorProfiles.firmId, FIRM));
    expect(rows.length).toBe(1);
    expect(rows[0].brandName).toBe("Summit");
    expect(rows[0].primaryColor).toBe("#123456");
  });

  it("setAdvisorBrandingEnabled toggles the grant", async () => {
    await setAdvisorBrandingEnabled(FIRM, "adv_a", true, "u_admin");
    expect((await getAdvisorProfile(FIRM, "adv_a"))?.brandingEnabled).toBe(true);
  });

  it("setAdvisorBrandingEnabled flips the flag without touching brand fields", async () => {
    await upsertAdvisorProfile(FIRM, "adv_a", { brandName: "X" }, "adv_a");
    await setAdvisorBrandingEnabled(FIRM, "adv_a", true, "u_admin");
    const rows = await db.select().from(advisorProfiles).where(eq(advisorProfiles.firmId, FIRM));
    expect(rows.length).toBe(1);
    expect(rows[0].brandName).toBe("X");
    expect(rows[0].brandingEnabled).toBe(true);

    await setAdvisorBrandingEnabled(FIRM, "adv_a", false, "u_admin");
    const rowsAfter = await db.select().from(advisorProfiles).where(eq(advisorProfiles.firmId, FIRM));
    expect(rowsAfter.length).toBe(1);
    expect(rowsAfter[0].brandName).toBe("X");
    expect(rowsAfter[0].brandingEnabled).toBe(false);
  });
});

// Task 15c renders the per-advisor grant list from this + listFirmMembers,
// which is why it must be ONE firm-scoped query and not an N+1 of
// getAdvisorProfile. This suite runs against the real database, so unlike the
// purge-firm harness it genuinely exercises the WHERE clause.
describe("listAdvisorProfiles", () => {
  beforeEach(async () => {
    await db.delete(advisorProfiles).where(eq(advisorProfiles.firmId, FIRM));
    await db.delete(advisorProfiles).where(eq(advisorProfiles.firmId, OTHER_FIRM));
  });

  it("returns an empty list for a firm with no profiles", async () => {
    expect(await listAdvisorProfiles(FIRM)).toEqual([]);
  });

  it("returns every profile in the firm", async () => {
    await upsertAdvisorProfile(FIRM, "adv_a", { brandName: "Summit" }, "adv_a");
    await upsertAdvisorProfile(FIRM, "adv_b", { brandName: "Ridge" }, "adv_b");

    const rows = await listAdvisorProfiles(FIRM);

    expect(rows.map((r) => r.advisorUserId).sort()).toEqual(["adv_a", "adv_b"]);
  });

  it("does NOT leak another firm's profiles", async () => {
    // The load-bearing case: an unscoped `select().from(advisorProfiles)`
    // passes every other assertion in this file.
    await upsertAdvisorProfile(FIRM, "adv_a", { brandName: "Summit" }, "adv_a");
    await upsertAdvisorProfile(OTHER_FIRM, "adv_x", { brandName: "Rival" }, "adv_x");

    const rows = await listAdvisorProfiles(FIRM);

    expect(rows).toHaveLength(1);
    expect(rows[0].advisorUserId).toBe("adv_a");
    expect(rows.every((r) => r.firmId === FIRM)).toBe(true);
  });

  it("carries the grant flag and brand fields the admin list renders", async () => {
    await upsertAdvisorProfile(FIRM, "adv_a", { brandName: "Summit" }, "adv_a");
    await setAdvisorBrandingEnabled(FIRM, "adv_a", true, "u_admin");

    const [row] = await listAdvisorProfiles(FIRM);

    expect(row.brandingEnabled).toBe(true);
    expect(row.brandName).toBe("Summit");
  });
});
