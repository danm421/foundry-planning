import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { requireCrmHouseholdAccess } from "../authz";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn() };
});

describe("requireCrmHouseholdAccess", () => {
  beforeEach(async () => {
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, "test_org_crm_authz"));
  });

  it("returns household when org matches", async () => {
    vi.mocked(requireOrgId).mockResolvedValue("test_org_crm_authz");
    const [created] = await db.insert(crmHouseholds).values({
      firmId: "test_org_crm_authz",
      advisorId: "test_advisor",
      name: "Test Household",
    }).returning();

    const { household, orgId } = await requireCrmHouseholdAccess(created.id);
    expect(household.id).toBe(created.id);
    expect(orgId).toBe("test_org_crm_authz");

    await db.delete(crmHouseholds).where(eq(crmHouseholds.id, created.id));
  });

  it("throws when org doesn't match", async () => {
    vi.mocked(requireOrgId).mockResolvedValue("different_org");
    const [created] = await db.insert(crmHouseholds).values({
      firmId: "test_org_crm_authz",
      advisorId: "test_advisor",
      name: "Test Household",
    }).returning();

    await expect(requireCrmHouseholdAccess(created.id)).rejects.toThrow(/not found or access denied/);

    await db.delete(crmHouseholds).where(eq(crmHouseholds.id, created.id));
  });
});
