import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds, staffAdvisorVisibility } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_clauthz") };
});
vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
    "@clerk/nextjs/server",
  );
  return { ...actual, auth: vi.fn() };
});

import { auth } from "@clerk/nextjs/server";
import { verifyClientAccess, requireClientAccess } from "../authz";

const ORG = "org_clauthz";
const ADV_A = "adv_a";
let clientId: string;

function setAuth(userId: string, orgRole?: string) {
  vi.mocked(auth).mockResolvedValue({ userId, orgId: ORG, orgRole } as never);
}

beforeEach(async () => {
  await db.delete(clients).where(eq(clients.firmId, ORG));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
  await db
    .delete(staffAdvisorVisibility)
    .where(eq(staffAdvisorVisibility.firmId, ORG));
  const [h] = await db
    .insert(crmHouseholds)
    .values({ firmId: ORG, advisorId: ADV_A, name: "HH" })
    .returning();
  const [c] = await db
    .insert(clients)
    .values({
      firmId: ORG,
      advisorId: ADV_A,
      crmHouseholdId: h.id,
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning();
  clientId = c.id;
});

describe("client access authz", () => {
  it("a member (firm-wide) gets access", async () => {
    setAuth("user_member", "org:member");
    expect(await verifyClientAccess(clientId, ORG)).toBe(true);
    await expect(requireClientAccess(clientId)).resolves.toMatchObject({
      firmId: ORG,
    });
  });

  it("a planner mapped to the client's advisor gets access", async () => {
    await db.insert(staffAdvisorVisibility).values({
      firmId: ORG,
      staffUserId: "user_planner",
      advisorUserId: ADV_A,
    });
    setAuth("user_planner", "org:planner");
    expect(await verifyClientAccess(clientId, ORG)).toBe(true);
    await expect(requireClientAccess(clientId)).resolves.toBeTruthy();
  });

  it("a planner NOT mapped to the client's advisor is denied", async () => {
    setAuth("user_planner_unmapped", "org:planner");
    expect(await verifyClientAccess(clientId, ORG)).toBe(false);
    await expect(requireClientAccess(clientId)).rejects.toThrow();
  });

  it("returns false for a client in another firm", async () => {
    setAuth("user_member", "org:member");
    expect(await verifyClientAccess(clientId, "org_other")).toBe(false);
  });
});
