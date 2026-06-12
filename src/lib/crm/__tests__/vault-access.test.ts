import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, staffAdvisorVisibility } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_vault_test") };
});

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
    "@clerk/nextjs/server",
  );
  return { ...actual, auth: vi.fn() };
});

import { auth } from "@clerk/nextjs/server";
import { requireVaultAccess } from "../authz";

const ORG = "org_vault_test";
const ADVISOR = "user_advisor";
const OTHER = "user_other_advisor";
let householdId: string;

function setAuth(userId: string, orgRole?: string) {
  vi.mocked(auth).mockResolvedValue({ userId, orgId: ORG, orgRole } as never);
}

beforeEach(async () => {
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
  const [h] = await db
    .insert(crmHouseholds)
    .values({ firmId: ORG, advisorId: ADVISOR, name: "Vault Test HH" })
    .returning();
  householdId = h.id;
});

describe("requireVaultAccess", () => {
  it("allows the assigned advisor", async () => {
    setAuth(ADVISOR, "org:member");
    const { household, orgId } = await requireVaultAccess(householdId);
    expect(household.id).toBe(householdId);
    expect(orgId).toBe(ORG);
  });

  it("allows a firm admin who is not the assigned advisor", async () => {
    setAuth(OTHER, "org:admin");
    await expect(requireVaultAccess(householdId)).resolves.toMatchObject({
      orgId: ORG,
    });
  });

  it("rejects a retired org:owner role", async () => {
    setAuth(OTHER, "org:owner");
    await expect(requireVaultAccess(householdId)).rejects.toThrow();
  });

  it("rejects another advisor in the same firm", async () => {
    setAuth(OTHER, "org:member");
    await expect(requireVaultAccess(householdId)).rejects.toThrow();
  });
});

describe("requireVaultAccess — staff roles", () => {
  beforeEach(async () => {
    await db
      .delete(staffAdvisorVisibility)
      .where(eq(staffAdvisorVisibility.firmId, ORG));
  });

  it("allows a planner mapped to the household's advisor", async () => {
    await db.insert(staffAdvisorVisibility).values({
      firmId: ORG,
      staffUserId: "user_planner",
      advisorUserId: ADVISOR,
    });
    setAuth("user_planner", "org:planner");
    await expect(requireVaultAccess(householdId)).resolves.toMatchObject({
      orgId: ORG,
    });
  });

  it("allows an operations member mapped to the household's advisor", async () => {
    await db.insert(staffAdvisorVisibility).values({
      firmId: ORG,
      staffUserId: "user_ops",
      advisorUserId: ADVISOR,
    });
    setAuth("user_ops", "org:operations");
    await expect(requireVaultAccess(householdId)).resolves.toBeTruthy();
  });

  it("rejects a staff member NOT mapped to the household's advisor", async () => {
    await db.insert(staffAdvisorVisibility).values({
      firmId: ORG,
      staffUserId: "user_planner",
      advisorUserId: OTHER, // mapped to a different advisor
    });
    setAuth("user_planner", "org:planner");
    await expect(requireVaultAccess(householdId)).rejects.toThrow();
  });
});
