// src/lib/clients/__tests__/expenses-writes.test.ts
//
// Core write tests for the expenses write-core — the template the income /
// liability / account cores will copy. Hits the real Neon dev branch and skips
// cleanly without a DB so it never adds to the no-delta failing set in CI.
// Mirrors preview-fidelity.test.ts's Cooper-fixture gating.
import { describe, it, expect, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { expenses } from "@/db/schema";
import {
  createExpenseForClient,
  updateExpenseForClient,
  deleteExpenseForClient,
} from "../expenses-writes";

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
    userId: "user_test_expense_core",
    orgRole: "org:admin",
    orgId: "org_3CitTEIe8PJa1BVYw7LnEjkiP9r",
  }),
}));

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
const ACTOR_ID = "user_test_expense_core";

// A real isDefault living-expense row for Cooper (seeded for every client).
// Sourced by querying `expenses where client_id = COOPER and is_default = true`.
const COOPER_DEFAULT_EXPENSE_ID = "de54f6d4-513a-4e9c-86d0-85f3dd741882";

// An account that belongs to a DIFFERENT client — used to prove cross-client FK
// isolation: attaching it as cashAccountId must be rejected 400, not written.
const FOREIGN_ACCOUNT_ID = "3d552610-0eff-47b4-a7bf-fe3a3805d876";

d("expenses-writes core", () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      await db.delete(expenses).where(eq(expenses.id, id));
    }
  });

  it("create happy path → {ok, data, resourceId === data.id}", async () => {
    const res = await createExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        type: "other",
        name: "Core test expense",
        annualAmount: 1234,
        startYear: 2030,
        endYear: 2040,
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return; // narrow for TS
    createdIds.push(res.data.id);
    expect(res.resourceId).toBe(res.data.id);
    expect(res.data.name).toBe("Core test expense");
    // decimal(15,2) round-trips as a fixed-scale string.
    expect(res.data.annualAmount).toBe("1234.00");
  });

  it("both-owner set → {ok:false, status:400}", async () => {
    const res = await createExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        type: "other",
        name: "Both owners",
        startYear: 2030,
        endYear: 2040,
        ownerEntityId: "11111111-1111-1111-1111-111111111111",
        ownerAccountId: "22222222-2222-2222-2222-222222222222",
      },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it("cross-client cashAccountId → {ok:false, status:400} (FK isolation)", async () => {
    const res = await createExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        type: "other",
        name: "Foreign cash account",
        startYear: 2030,
        endYear: 2040,
        cashAccountId: FOREIGN_ACCOUNT_ID,
      },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    // The row must NOT have been written.
    const rows = await db
      .select()
      .from(expenses)
      .where(eq(expenses.cashAccountId, FOREIGN_ACCOUNT_ID));
    expect(rows.length).toBe(0);
  });

  it("delete an isDefault row → {ok:false, status:400, /default/i}", async () => {
    const res = await deleteExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      expenseId: COOPER_DEFAULT_EXPENSE_ID,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/default/i);
    // The default row must still exist.
    const [still] = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(eq(expenses.id, COOPER_DEFAULT_EXPENSE_ID));
    expect(still?.id).toBe(COOPER_DEFAULT_EXPENSE_ID);
  });

  it("change the type of an isDefault row → {ok:false, status:400, /type/i}", async () => {
    const res = await updateExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      expenseId: COOPER_DEFAULT_EXPENSE_ID,
      input: { type: "other" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/type/i);
    // The default row keeps its living type.
    const [still] = await db
      .select({ type: expenses.type })
      .from(expenses)
      .where(eq(expenses.id, COOPER_DEFAULT_EXPENSE_ID));
    expect(still?.type).toBe("living");
  });

  it("editing an isDefault row's amount (not type) still succeeds", async () => {
    // Cooper's seeded default row lives on the shared dev branch — capture and
    // restore its amount so this test leaves no residue.
    const [before] = await db
      .select({ annualAmount: expenses.annualAmount })
      .from(expenses)
      .where(eq(expenses.id, COOPER_DEFAULT_EXPENSE_ID));
    try {
      const res = await updateExpenseForClient({
        clientId: COOPER_CLIENT_ID,
        firmId: COOPER_FIRM_ID,
        actorId: ACTOR_ID,
        expenseId: COOPER_DEFAULT_EXPENSE_ID,
        // Re-sending the unchanged type alongside an edit must NOT trip the guard.
        input: { type: "living", annualAmount: 4321 },
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.data.annualAmount).toBe("4321.00");
      expect(res.data.type).toBe("living");
    } finally {
      await db
        .update(expenses)
        .set({ annualAmount: before?.annualAmount ?? "0" })
        .where(eq(expenses.id, COOPER_DEFAULT_EXPENSE_ID));
    }
  });

  it("creating a living expense drops any deductionType", async () => {
    const res = await createExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        type: "living",
        name: "Living with stray deduction",
        annualAmount: 100,
        startYear: 2030,
        endYear: 2040,
        deductionType: "charitable",
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    createdIds.push(res.data.id);
    expect(res.data.deductionType).toBeNull();
  });

  it("retyping an expense to living clears its deductionType", async () => {
    const created = await createExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        type: "other",
        name: "Other → living",
        annualAmount: 100,
        startYear: 2030,
        endYear: 2040,
        deductionType: "charitable",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdIds.push(created.data.id);
    expect(created.data.deductionType).toBe("charitable");

    const res = await updateExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      expenseId: created.data.id,
      input: { type: "living" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.type).toBe("living");
    expect(res.data.deductionType).toBeNull();
  });

  it("update happy path → {ok, data} with the new field", async () => {
    const created = await createExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        type: "other",
        name: "Update target",
        annualAmount: 100,
        startYear: 2030,
        endYear: 2040,
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdIds.push(created.data.id);

    const res = await updateExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      expenseId: created.data.id,
      input: { annualAmount: 999 },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.resourceId).toBe(created.data.id);
    expect(res.data.annualAmount).toBe("999.00");
    // Untouched field preserved.
    expect(res.data.name).toBe("Update target");
  });
});
