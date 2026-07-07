// Route-vs-core equivalence test for POST /api/clients/[id]/expenses.
//
// Drives the route handler AND createExpenseForClient with identical input;
// asserts the persisted rows are structurally identical (ignoring id /
// createdAt / updatedAt) and that both fire an "expense.create" audit entry.
// DB-gated so it skips cleanly in CI without DATABASE_URL.
//
// Mock strategy: identical to expenses-writes.test.ts — mock
// @clerk/nextjs/server so auth() returns an org:admin for COOPER_FIRM_ID.
// requireOrgAndUser (route) reads auth() directly; verifyClientAccess (core) also
// reads auth(). The org:admin role is NOT in STAFF_ROLES so staffMaySeeAdvisor
// short-circuits true, and access reduces to the DB firm-membership check.
import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sweepLeakedAuditRows } from "@/lib/audit/test-helpers";
import { expenses, auditLog } from "@/db/schema";
import { createExpenseForClient } from "@/lib/clients/expenses-writes";
import { POST } from "../route";

// Mock Clerk auth to return org:admin inside COOPER_FIRM_ID with founder bypass so
// requireActiveSubscriptionForFirm passes without a live Clerk API call.
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({
    userId: "user_route_equiv_test",
    orgId: "org_3CitTEIe8PJa1BVYw7LnEjkiP9r",
    orgRole: "org:admin",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  }),
}));

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";

// Shared test payload — every field normalised to the values both paths accept.
const TEST_BODY = {
  type: "other",
  name: "Equivalence test expense",
  annualAmount: "5678",
  startYear: 2031,
  endYear: 2041,
  growthRate: "0.02",
  growthSource: "custom",
} as const;

d("POST /expenses route vs createExpenseForClient core — equivalence", () => {
  const createdIds: string[] = [];
  sweepLeakedAuditRows(COOPER_CLIENT_ID);

  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      await db.delete(expenses).where(eq(expenses.id, id));
    }
  });

  it("both paths persist structurally-identical rows and fire expense.create audit", async () => {
    // --- 1. Route path ---
    const req = new NextRequest(
      `http://localhost/api/clients/${COOPER_CLIENT_ID}/expenses`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(TEST_BODY),
      },
    );
    const routeRes = await POST(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID }),
    });
    expect(routeRes.status).toBe(201);
    const routeData = (await routeRes.json()) as typeof expenses.$inferSelect;
    createdIds.push(routeData.id);

    // --- 2. Core path ---
    const coreResult = await createExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: COOPER_FIRM_ID,
      input: TEST_BODY,
    });
    expect(coreResult.ok).toBe(true);
    if (!coreResult.ok) return; // narrow for TS
    createdIds.push(coreResult.data.id);

    // --- 3. Structural comparison (ignore id, createdAt, updatedAt) ---
    const strip = (row: typeof expenses.$inferSelect) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = row;
      return rest;
    };

    expect(strip(routeData)).toEqual(strip(coreResult.data));

    // --- 4. Both fired expense.create audit entries ---
    const auditRows = await db
      .select({ action: auditLog.action, resourceId: auditLog.resourceId, actorId: auditLog.actorId })
      .from(auditLog)
      .where(
        eq(auditLog.resourceId, routeData.id),
      );
    const coreAuditRows = await db
      .select({ action: auditLog.action, resourceId: auditLog.resourceId, actorId: auditLog.actorId })
      .from(auditLog)
      .where(
        eq(auditLog.resourceId, coreResult.data.id),
      );

    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows[0].action).toBe("expense.create");
    // SOC2 regression: route must record the real userId, not the org id.
    expect(auditRows[0].actorId).toBe("user_route_equiv_test");

    expect(coreAuditRows.length).toBeGreaterThan(0);
    expect(coreAuditRows[0].action).toBe("expense.create");
  });
});
