/**
 * DB integration test for the Task 10 `coveredByWorkplacePlan` /
 * `spouseCoveredByWorkplacePlan` override columns. These live on `clients`,
 * not `planSettings` — the route updates both tables, so the round trip must
 * be verified against the `clients` row, not just the `planSettings` row the
 * handler primarily targets.
 *
 * Note: Neon dev branch cold-starts after idle; run with --testTimeout=30000.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds, scenarios, planSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: async () => "test-firm-workplace-coverage",
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({
    userId: "user_test",
    orgId: "test-firm-workplace-coverage",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  }),
}));

import { PUT } from "../route";

const FIRM = "test-firm-workplace-coverage";

describe("PUT /api/clients/[id]/plan-settings — workplace-plan coverage overrides", () => {
  let householdId: string;
  let clientId: string;
  let scenarioId: string;

  beforeAll(async () => {
    const [hh] = await db
      .insert(crmHouseholds)
      .values({ firmId: FIRM, advisorId: "u", name: "Workplace Coverage Test", status: "active" })
      .returning();
    householdId = hh.id;

    const [c] = await db.insert(clients).values({
      firmId: FIRM, advisorId: "u", crmHouseholdId: householdId,
      retirementAge: 65, planEndAge: 95, lifeExpectancy: 95, filingStatus: "married_joint",
    }).returning();
    clientId = c.id;

    const [sc] = await db.insert(scenarios).values({
      clientId, name: "Base Case", isBaseCase: true,
    }).returning();
    scenarioId = sc.id;

    await db.insert(planSettings).values({
      clientId, scenarioId, planStartYear: 2026, planEndYear: 2065,
    });
  });

  afterAll(async () => {
    await db.delete(planSettings).where(eq(planSettings.clientId, clientId));
    await db.delete(scenarios).where(eq(scenarios.id, scenarioId));
    await db.delete(clients).where(eq(clients.id, clientId));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdId));
  });

  function mockRequest(body: unknown) {
    return new Request("http://test", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as unknown as Parameters<typeof PUT>[0];
  }

  it("defaults both columns to 'auto' on insert (schema default, not code under test)", async () => {
    const [row] = await db.select().from(clients).where(eq(clients.id, clientId));
    expect(row.coveredByWorkplacePlan).toBe("auto");
    expect(row.spouseCoveredByWorkplacePlan).toBe("auto");
  });

  it(
    "persists DISTINCT non-default values for each column independently and returns them in the response body — " +
      "kills a mutant that conflates the two columns (e.g. writes spouseCoveredByWorkplacePlan's value to both, " +
      "or drops one of the two .set() keys) since both start at the same default and only a per-column check would " +
      "catch that split being wrong",
    async () => {
      const res = await PUT(
        mockRequest({ coveredByWorkplacePlan: "yes", spouseCoveredByWorkplacePlan: "no" }),
        { params: Promise.resolve({ id: clientId }) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.coveredByWorkplacePlan).toBe("yes");
      expect(body.spouseCoveredByWorkplacePlan).toBe("no");

      const [row] = await db.select().from(clients).where(eq(clients.id, clientId));
      expect(row.coveredByWorkplacePlan).toBe("yes");
      expect(row.spouseCoveredByWorkplacePlan).toBe("no");

      // The values must NOT have landed on planSettings — this is a clients-table
      // concern (household-level), not a scenario-level plan setting.
      const [settingsRow] = await db
        .select()
        .from(planSettings)
        .where(eq(planSettings.clientId, clientId));
      expect(settingsRow).not.toHaveProperty("coveredByWorkplacePlan");
      expect(settingsRow).not.toHaveProperty("spouseCoveredByWorkplacePlan");
    },
  );

  it("rejects an out-of-enum value with 400 and leaves both stored values unchanged", async () => {
    const res = await PUT(
      mockRequest({ coveredByWorkplacePlan: "sometimes" }),
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(res.status).toBe(400);

    const [row] = await db.select().from(clients).where(eq(clients.id, clientId));
    // Unchanged from the previous test.
    expect(row.coveredByWorkplacePlan).toBe("yes");
    expect(row.spouseCoveredByWorkplacePlan).toBe("no");
  });

  it("leaves both columns untouched when omitted from the body (an unrelated plan-settings edit must not reset them)", async () => {
    const res = await PUT(
      mockRequest({ outOfHouseholdDniRate: "0.30" }),
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(res.status).toBe(200);

    const [row] = await db.select().from(clients).where(eq(clients.id, clientId));
    expect(row.coveredByWorkplacePlan).toBe("yes");
    expect(row.spouseCoveredByWorkplacePlan).toBe("no");
  });
});
