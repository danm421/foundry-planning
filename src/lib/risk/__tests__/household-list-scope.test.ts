import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import {
  firms,
  crmHouseholds,
  clients,
  clientRiskProfiles,
  staffAdvisorVisibility,
} from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_riskscope") };
});

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
    "@clerk/nextjs/server",
  );
  return { ...actual, auth: vi.fn() };
});

import { auth } from "@clerk/nextjs/server";
import { listRiskProfiles } from "../queries";

const ORG = "org_riskscope";
const ADV_A = "adv_a";
const ADV_B = "adv_b";

function setAuth(userId: string, orgRole?: string) {
  vi.mocked(auth).mockResolvedValue({ userId, orgId: ORG, orgRole } as never);
}

/**
 * `listRiskProfiles` (unlike `listCrmHouseholds`) selects FROM `clients` INNER
 * JOIN `crmHouseholds` -- so every fixture household needs a `clients` row too,
 * plus a `client_risk_profiles` row so the LEFT JOIN has real data to carry
 * through the scope filter, not just nulls.
 */
async function seedHousehold(
  advisorId: string,
  name: string,
  compositeLevel: "moderate" | "aggressive",
) {
  const [h] = await db
    .insert(crmHouseholds)
    .values({ firmId: ORG, advisorId, name })
    .returning();
  const [c] = await db
    .insert(clients)
    .values({
      firmId: ORG,
      advisorId,
      crmHouseholdId: h.id,
      retirementAge: 65,
      planEndAge: 95,
      lifeExpectancy: 95,
      filingStatus: "single",
    })
    .returning();
  await db.insert(clientRiskProfiles).values({
    firmId: ORG,
    clientId: c.id,
    toleranceScore: 55,
    toleranceSource: "manual",
    compositeScore: 55,
    compositeLevel,
    bindingConstraint: "tolerance",
  });
  return { householdId: h.id, clientId: c.id };
}

describe("listRiskProfiles visibility scoping", () => {
  beforeEach(async () => {
    // clients is a RESTRICT fk off crmHouseholds, so it goes first (matches
    // api/clients/__tests__/list-scope.test.ts). client_risk_profiles cascades
    // off both clients and firms, so it's covered by either delete -- firms
    // still needs its own delete+reinsert since client_risk_profiles.firm_id
    // has a hard FK to it (crm_households/clients do not).
    await db.delete(clients).where(eq(clients.firmId, ORG));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
    await db
      .delete(staffAdvisorVisibility)
      .where(eq(staffAdvisorVisibility.firmId, ORG));
    await db.delete(firms).where(eq(firms.firmId, ORG));
    await db.insert(firms).values({ firmId: ORG });
    await seedHousehold(ADV_A, "A HH", "moderate");
    await seedHousehold(ADV_B, "B HH", "aggressive");
  });

  it("a member sees all firm households", async () => {
    setAuth("user_member", "org:member");
    const rows = await listRiskProfiles();
    expect(rows.map((r) => r.householdName).sort()).toEqual(["A HH", "B HH"]);
  });

  it("an operations member sees only mapped advisors' households", async () => {
    await db.insert(staffAdvisorVisibility).values({
      firmId: ORG,
      staffUserId: "user_ops",
      advisorUserId: ADV_B,
    });
    setAuth("user_ops", "org:operations");
    const rows = await listRiskProfiles();
    expect(rows.map((r) => r.householdName)).toEqual(["B HH"]);
  });

  it("a staff member mapped to nobody sees nothing", async () => {
    setAuth("user_ops_unmapped", "org:operations");
    const rows = await listRiskProfiles();
    expect(rows).toHaveLength(0);
  });

  it("an admin with viewAsAdvisorId sees only that advisor's households", async () => {
    setAuth("user_admin", "org:admin");
    const rows = await listRiskProfiles({ viewAsAdvisorId: ADV_A });
    expect(rows.map((r) => r.householdName)).toEqual(["A HH"]);
  });

  // REGRESSION (empty-list trap): "all" must mean "no narrowing", not
  // narrowToAdvisor(visible, "all") -> an advisorId IN ('all') filter that
  // silently matches nothing. Proves applyBookSwitcher is actually wired in
  // here via a real DB-backed query, not just unit-tested in isolation.
  it('an admin with viewAsAdvisorId: "all" sees the FULL unnarrowed list', async () => {
    setAuth("user_admin", "org:admin");
    const rows = await listRiskProfiles({ viewAsAdvisorId: "all" });
    expect(rows.map((r) => r.householdName).sort()).toEqual(["A HH", "B HH"]);
  });

  // SECURITY-CRITICAL: narrowToAdvisor replaces (not narrows) whatever set it's
  // given, so a non-admin's viewAsAdvisorId MUST be ignored -- never widen a
  // siloed/staff member's scope to some other advisor the client asked for.
  // Without this gate, the Risk page becomes a way to enumerate households
  // outside the caller's book.
  it("a non-admin's viewAsAdvisorId does NOT widen their scope", async () => {
    await db.insert(staffAdvisorVisibility).values({
      firmId: ORG,
      staffUserId: "user_ops",
      advisorUserId: ADV_B,
    });
    setAuth("user_ops", "org:operations");
    const rows = await listRiskProfiles({ viewAsAdvisorId: ADV_A });
    // Still scoped to the staff member's own mapping (ADV_B), NOT ADV_A.
    expect(rows.map((r) => r.householdName)).toEqual(["B HH"]);
  });
});
