import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, staffAdvisorVisibility } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_hhscope") };
});

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
    "@clerk/nextjs/server",
  );
  return { ...actual, auth: vi.fn() };
});

import { auth } from "@clerk/nextjs/server";
import { listCrmHouseholds } from "../households";

const ORG = "org_hhscope";
const ADV_A = "adv_a";
const ADV_B = "adv_b";

function setAuth(userId: string, orgRole?: string) {
  vi.mocked(auth).mockResolvedValue({ userId, orgId: ORG, orgRole } as never);
}

describe("listCrmHouseholds visibility scoping", () => {
  beforeEach(async () => {
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
    await db
      .delete(staffAdvisorVisibility)
      .where(eq(staffAdvisorVisibility.firmId, ORG));
    await db.insert(crmHouseholds).values([
      { firmId: ORG, advisorId: ADV_A, name: "A HH" },
      { firmId: ORG, advisorId: ADV_B, name: "B HH" },
    ]);
  });

  it("a member sees all firm households", async () => {
    setAuth("user_member", "org:member");
    const rows = await listCrmHouseholds();
    expect(rows.map((r) => r.name).sort()).toEqual(["A HH", "B HH"]);
  });

  it("an operations member sees only mapped advisors' households", async () => {
    await db.insert(staffAdvisorVisibility).values({
      firmId: ORG,
      staffUserId: "user_ops",
      advisorUserId: ADV_B,
    });
    setAuth("user_ops", "org:operations");
    const rows = await listCrmHouseholds();
    expect(rows.map((r) => r.name)).toEqual(["B HH"]);
  });

  it("a staff member mapped to nobody sees nothing", async () => {
    setAuth("user_ops_unmapped", "org:operations");
    const rows = await listCrmHouseholds();
    expect(rows).toHaveLength(0);
  });
});
