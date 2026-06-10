import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds } from "@/db/schema";
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

  it("allows a firm owner", async () => {
    setAuth(OTHER, "org:owner");
    await expect(requireVaultAccess(householdId)).resolves.toBeTruthy();
  });

  it("rejects another advisor in the same firm", async () => {
    setAuth(OTHER, "org:member");
    await expect(requireVaultAccess(householdId)).rejects.toThrow();
  });
});
