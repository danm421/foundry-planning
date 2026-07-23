import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { advisorProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getAdvisorProfile, upsertAdvisorProfile, setAdvisorBrandingEnabled } from "../advisor-profile";

const FIRM = "org_advprof_test";

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
});
