import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds, staffAdvisorVisibility } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyClientAccessFor } from "../authz";

const ORG = "org_principal_test";
const ADV_A = "adv_principal_a";
let clientId: string;

beforeEach(async () => {
  await db.delete(clients).where(eq(clients.firmId, ORG));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
  await db.delete(staffAdvisorVisibility).where(eq(staffAdvisorVisibility.firmId, ORG));
  const [h] = await db
    .insert(crmHouseholds)
    .values({ firmId: ORG, advisorId: ADV_A, name: "HH" })
    .returning();
  const [c] = await db
    .insert(clients)
    .values({ firmId: ORG, advisorId: ADV_A, crmHouseholdId: h.id, retirementAge: 65, planEndAge: 95 })
    .returning();
  clientId = c.id;
});

describe("verifyClientAccessFor", () => {
  it("grants a firm member edit access with no Clerk session present", async () => {
    const result = await verifyClientAccessFor(
      { userId: "user_member", orgId: ORG, orgRole: "org:member" },
      clientId,
    );
    expect(result).toMatchObject({ ok: true, permission: "edit", access: "own" });
  });

  it("denies a principal from another org", async () => {
    const result = await verifyClientAccessFor(
      { userId: "user_outsider", orgId: "org_somewhere_else", orgRole: "org:member" },
      clientId,
    );
    expect(result).toEqual({ ok: false });
  });

  it("denies unmapped staff in a siloed firm", async () => {
    const result = await verifyClientAccessFor(
      { userId: "user_planner", orgId: ORG, orgRole: "org:planner" },
      clientId,
    );
    expect(result).toEqual({ ok: false });
  });

  it("grants staff mapped to the client's advisor", async () => {
    await db.insert(staffAdvisorVisibility).values({
      firmId: ORG,
      staffUserId: "user_planner",
      advisorUserId: ADV_A,
    });
    const result = await verifyClientAccessFor(
      { userId: "user_planner", orgId: ORG, orgRole: "org:planner" },
      clientId,
    );
    expect(result).toMatchObject({ ok: true, access: "own" });
  });

  it("denies a principal with no org", async () => {
    const result = await verifyClientAccessFor(
      { userId: "user_orgless", orgId: null, orgRole: null },
      clientId,
    );
    expect(result).toEqual({ ok: false });
  });
});
