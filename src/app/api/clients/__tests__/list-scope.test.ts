import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import {
  crmHouseholds,
  crmHouseholdContacts,
  clients,
  staffAdvisorVisibility,
} from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_listscope") };
});

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
    "@clerk/nextjs/server",
  );
  return { ...actual, auth: vi.fn() };
});

import { auth } from "@clerk/nextjs/server";
import { GET } from "../route";

const ORG = "org_listscope";
const ADV_A = "adv_a";
const ADV_B = "adv_b";

function setAuth(userId: string, orgRole?: string) {
  vi.mocked(auth).mockResolvedValue({ userId, orgId: ORG, orgRole } as never);
}

async function seedClient(advisorId: string, last: string) {
  const [h] = await db
    .insert(crmHouseholds)
    .values({ firmId: ORG, advisorId, name: `${last} HH` })
    .returning();
  await db.insert(crmHouseholdContacts).values({
    householdId: h.id,
    role: "primary",
    firstName: "Test",
    lastName: last,
  });
  await db.insert(clients).values({
    firmId: ORG,
    advisorId,
    crmHouseholdId: h.id,
    retirementAge: 65,
    planEndAge: 95,
    lifeExpectancy: 95,
    filingStatus: "single",
  });
}

describe("GET /api/clients visibility scoping", () => {
  beforeEach(async () => {
    await db.delete(clients).where(eq(clients.firmId, ORG));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
    await db
      .delete(staffAdvisorVisibility)
      .where(eq(staffAdvisorVisibility.firmId, ORG));
    await seedClient(ADV_A, "Apple");
    await seedClient(ADV_B, "Banana");
  });

  it("a member sees all firm clients", async () => {
    setAuth("user_member", "org:member");
    const res = await GET();
    const rows = await res.json();
    expect(rows.map((r: { lastName: string }) => r.lastName).sort()).toEqual([
      "Apple",
      "Banana",
    ]);
  });

  it("a planner sees only mapped advisors' clients", async () => {
    await db.insert(staffAdvisorVisibility).values({
      firmId: ORG,
      staffUserId: "user_planner",
      advisorUserId: ADV_A,
    });
    setAuth("user_planner", "org:planner");
    const res = await GET();
    const rows = await res.json();
    expect(rows.map((r: { lastName: string }) => r.lastName)).toEqual(["Apple"]);
  });
});
