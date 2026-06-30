// src/lib/clients/__tests__/incomes-writes.test.ts
//
// Core write tests for the incomes write-core — mirrors expenses-writes.test.ts
// with income-specific adjustments. Hits the real Neon dev branch and skips
// cleanly without a DB so it never adds to the no-delta failing set in CI.
import { describe, it, expect, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { incomes } from "@/db/schema";
import {
  createIncomeForClient,
  updateIncomeForClient,
  deleteIncomeForClient,
} from "../incomes-writes";

// verifyClientAccess (via authz.ts → staffMaySeeAdvisor) calls Clerk's auth(),
// which throws under vitest. Mock it to a firm-wide admin: org:admin is not a
// STAFF_ROLE, so the staff-scope check short-circuits true and access reduces to
// the DB firm-membership check. recordAudit gets actorId explicitly from the
// core, so it never reads auth() here.
vi.mock("@clerk/nextjs/server", () => ({
  // orgId must equal COOPER_FIRM_ID so the real verifyClientAccess own-firm path
  // (`client.firmId === orgId`) matches and the write-core gate `a.firmId !== firmId`
  // passes. vi.mock is hoisted above the COOPER_FIRM_ID const, so inline the literal.
  auth: async () => ({
    userId: "user_test_income_core",
    orgRole: "org:admin",
    orgId: "org_3CitTEIe8PJa1BVYw7LnEjkiP9r",
  }),
}));

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
const ACTOR_ID = "user_test_income_core";

// An account that belongs to a DIFFERENT client — used to prove cross-client FK
// isolation: attaching it as cashAccountId must be rejected 400, not written.
const FOREIGN_ACCOUNT_ID = "3d552610-0eff-47b4-a7bf-fe3a3805d876";

d("incomes-writes core", () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      await db.delete(incomes).where(eq(incomes.id, id));
    }
  });

  it("create happy path → {ok, data, resourceId === data.id} + SS field round-trips", async () => {
    const res = await createIncomeForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        type: "salary",
        name: "Core test income",
        annualAmount: 95000,
        startYear: 2025,
        endYear: 2045,
        owner: "spouse",
        claimingAge: 67,
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return; // narrow for TS
    createdIds.push(res.data.id);
    expect(res.resourceId).toBe(res.data.id);
    expect(res.data.name).toBe("Core test income");
    // decimal(15,2) round-trips as a fixed-scale string.
    expect(res.data.annualAmount).toBe("95000.00");
    // SS-specific field round-trips.
    expect(res.data.owner).toBe("spouse");
    expect(res.data.claimingAge).toBe(67);
  });

  it("both-owner set → {ok:false, status:400}", async () => {
    const res = await createIncomeForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        type: "salary",
        name: "Both owners",
        startYear: 2025,
        endYear: 2045,
        ownerEntityId: "11111111-1111-1111-1111-111111111111",
        ownerAccountId: "22222222-2222-2222-2222-222222222222",
      },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it("cross-client cashAccountId → {ok:false, status:400} (FK isolation)", async () => {
    const res = await createIncomeForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        type: "salary",
        name: "Foreign cash account",
        startYear: 2025,
        endYear: 2045,
        cashAccountId: FOREIGN_ACCOUNT_ID,
      },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    // The row must NOT have been written.
    const rows = await db
      .select()
      .from(incomes)
      .where(eq(incomes.cashAccountId, FOREIGN_ACCOUNT_ID));
    expect(rows.length).toBe(0);
  });

  it("delete happy path → create then delete returns {ok:true, data:{id}} and row is gone", async () => {
    // Create first
    const created = await createIncomeForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        type: "salary",
        name: "Delete target",
        annualAmount: 50000,
        startYear: 2025,
        endYear: 2040,
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const incomeId = created.data.id;
    // Do NOT push to createdIds — delete will clean it up.

    const res = await deleteIncomeForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      incomeId,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual({ id: incomeId });

    // Row must be gone.
    const rows = await db
      .select({ id: incomes.id })
      .from(incomes)
      .where(eq(incomes.id, incomeId));
    expect(rows.length).toBe(0);
  });

  it("update happy path → {ok, data} with changed field, others untouched", async () => {
    const created = await createIncomeForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        type: "salary",
        name: "Update target",
        annualAmount: 100000,
        startYear: 2025,
        endYear: 2045,
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdIds.push(created.data.id);

    const res = await updateIncomeForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      incomeId: created.data.id,
      input: { annualAmount: 120000 },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.resourceId).toBe(created.data.id);
    expect(res.data.annualAmount).toBe("120000.00");
    // Untouched fields preserved.
    expect(res.data.name).toBe("Update target");
    expect(res.data.type).toBe("salary");
  });

  it("update persists taxType (tax-exempt edit) — regression for dropped taxType", async () => {
    const created = await createIncomeForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        type: "salary",
        name: "Tax-treatment edit target",
        annualAmount: 80000,
        startYear: 2025,
        endYear: 2045,
        taxType: "ordinary_income",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdIds.push(created.data.id);
    expect(created.data.taxType).toBe("ordinary_income");

    const res = await updateIncomeForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      incomeId: created.data.id,
      input: { taxType: "tax_exempt" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The edited tax treatment must round-trip — otherwise the engine keeps
    // taxing income the advisor marked tax-exempt.
    expect(res.data.taxType).toBe("tax_exempt");
  });
});
