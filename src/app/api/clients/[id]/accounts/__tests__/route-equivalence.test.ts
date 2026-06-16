// Route-vs-core equivalence test for POST /api/clients/[id]/accounts.
//
// Drives the route handler AND createAccountForClient with identical input;
// asserts the persisted rows are structurally identical (ignoring id /
// createdAt / updatedAt), that both fire an "account.create" audit entry,
// and that the route recorded the real Clerk userId (not the org id) as actorId
// (SOC2 regression guard).
//
// Also asserts accountOwners rows match structurally between both paths.
//
// DB-gated so it skips cleanly in CI without DATABASE_URL.
//
// Mock strategy: mock @clerk/nextjs/server so auth() returns an org:admin for
// COOPER_FIRM_ID. requireOrgAndUser (route) reads auth() directly;
// verifyClientAccess (core) also reads auth(). The org:admin role is NOT in
// STAFF_ROLES so staffMaySeeAdvisor short-circuits true, and access reduces to
// the DB firm-membership check.
import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, accountOwners, auditLog } from "@/db/schema";
import { createAccountForClient } from "@/lib/clients/accounts-writes";
import { POST } from "../route";

// Mock Clerk auth to return org:admin inside COOPER_FIRM_ID.
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({
    userId: "user_route_equiv_test",
    orgId: "org_3CitTEIe8PJa1BVYw7LnEjkiP9r",
    orgRole: "org:admin",
  }),
}));

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";

// Simple create body — no parentAccountId, no explicit owners — so both paths
// take the legacy-synthesis path and each writes ONE owner row (the Cooper
// client family member at 100%). Avoids business-only paths.
// NOTE: account_category has NO "investment" value — use "taxable".
const TEST_BODY = {
  name: "Equiv test account",
  category: "taxable",
} as const;

d("POST /accounts route vs createAccountForClient core — equivalence", () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      // accountOwners cascade-deletes when account is deleted.
      await db.delete(accounts).where(eq(accounts.id, id));
    }
  });

  it("both paths persist structurally-identical rows, matching accountOwners, and fire account.create audit with real userId as actorId", async () => {
    // --- 1. Route path ---
    const req = new NextRequest(
      `http://localhost/api/clients/${COOPER_CLIENT_ID}/accounts`,
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
    const routeData = (await routeRes.json()) as typeof accounts.$inferSelect;
    createdIds.push(routeData.id);

    // --- 2. Core path ---
    const coreResult = await createAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: COOPER_FIRM_ID,
      input: TEST_BODY,
    });
    expect(coreResult.ok).toBe(true);
    if (!coreResult.ok) return; // narrow for TS
    createdIds.push(coreResult.data.id);

    // --- 3. Structural comparison of account rows (ignore id, createdAt, updatedAt) ---
    const strip = (row: typeof accounts.$inferSelect) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = row;
      return rest;
    };

    expect(strip(routeData)).toEqual(strip(coreResult.data));

    // --- 4. Structurally-identical accountOwners rows ---
    const routeOwners = await db
      .select()
      .from(accountOwners)
      .where(eq(accountOwners.accountId, routeData.id));
    const coreOwners = await db
      .select()
      .from(accountOwners)
      .where(eq(accountOwners.accountId, coreResult.data.id));

    // Both should have exactly 1 owner row (legacy synthesis → client family member at 100%)
    expect(routeOwners).toHaveLength(1);
    expect(coreOwners).toHaveLength(1);

    // Strip id, accountId, createdAt, updatedAt for structural comparison
    const stripOwner = (row: typeof accountOwners.$inferSelect) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, accountId: _aid, createdAt: _ca, updatedAt: _ua, ...rest } = row;
      return rest;
    };
    expect(stripOwner(routeOwners[0])).toEqual(stripOwner(coreOwners[0]));

    // --- 5. Both fired account.create audit entries ---
    const routeAuditRows = await db
      .select({ action: auditLog.action, resourceId: auditLog.resourceId, actorId: auditLog.actorId })
      .from(auditLog)
      .where(eq(auditLog.resourceId, routeData.id));

    const coreAuditRows = await db
      .select({ action: auditLog.action, resourceId: auditLog.resourceId, actorId: auditLog.actorId })
      .from(auditLog)
      .where(eq(auditLog.resourceId, coreResult.data.id));

    expect(routeAuditRows.length).toBeGreaterThan(0);
    expect(routeAuditRows[0].action).toBe("account.create");
    // SOC2 regression: route must record the real userId (not the org id) as actorId.
    // This guards against the route accidentally passing firmId as actorId.
    expect(routeAuditRows[0].actorId).toBe("user_route_equiv_test");

    expect(coreAuditRows.length).toBeGreaterThan(0);
    expect(coreAuditRows[0].action).toBe("account.create");
  });
});
