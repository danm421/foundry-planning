import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds, familyMembers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCrmHousehold } from "../households";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("test_org_hhfam") };
});

const FIRM = "test_org_hhfam";

describe("getCrmHousehold planning family members", () => {
  let householdId: string;
  let clientId: string;

  beforeEach(async () => {
    await db.delete(clients).where(eq(clients.firmId, FIRM));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, FIRM));
    const [h] = await db.insert(crmHouseholds).values({
      firmId: FIRM, advisorId: "test_advisor", name: "HH Fam",
    }).returning();
    householdId = h.id;
    const [c] = await db.insert(clients).values({
      firmId: FIRM, advisorId: "test_advisor",
      retirementAge: 65, planEndAge: 90, crmHouseholdId: h.id,
    }).returning();
    clientId = c.id;
  });

  it("returns family members excluding the client/spouse self-rows", async () => {
    await db.insert(familyMembers).values([
      { clientId, firstName: "Dan", lastName: "Self", relationship: "other", role: "client" },
      { clientId, firstName: "Sue", lastName: "Self", relationship: "other", role: "spouse" },
      { clientId, firstName: "Emma", lastName: "Self", relationship: "child" },
      { clientId, firstName: "Pat", lastName: "Elder", relationship: "parent" },
    ]);
    const hh = await getCrmHousehold(householdId);
    const names = hh!.planningClient!.familyMembers.map((m) => m.firstName);
    expect(names).toContain("Emma");
    expect(names).toContain("Pat");
    expect(names).not.toContain("Dan");
    expect(names).not.toContain("Sue");
  });

  it("returns an empty list for a household without members", async () => {
    const hh = await getCrmHousehold(householdId);
    expect(hh!.planningClient!.familyMembers).toEqual([]);
  });
});
