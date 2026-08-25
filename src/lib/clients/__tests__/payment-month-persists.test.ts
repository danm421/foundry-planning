// src/lib/clients/__tests__/payment-month-persists.test.ts
//
// The "Paid in" month is guarded at every OTHER layer — the dialog's payload,
// the zod schemas, the engine→view adapter, save-to-base and promote-coerce —
// but nothing pinned the write-core, which is the layer that actually puts the
// column in the database. Dropping it from either writer left the whole suite
// green while the feature silently stopped persisting from the Cash Flow screen.
// Hits the real Neon dev branch and skips cleanly without a DB, like its
// neighbours.
import { describe, it, expect, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sweepLeakedAuditRows } from "@/lib/audit/test-helpers";
import { incomes, expenses } from "@/db/schema";
import { createIncomeForClient, updateIncomeForClient } from "../incomes-writes";
import { createExpenseForClient, updateExpenseForClient } from "../expenses-writes";

// Same mock as incomes-writes.test.ts: org:admin is not a STAFF_ROLE, so the
// staff-scope check short-circuits and access reduces to DB firm membership.
// vi.mock is hoisted above the consts below, so the orgId literal is inlined.
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({
    userId: "user_test_payment_month",
    orgRole: "org:admin",
    orgId: "org_3CitTEIe8PJa1BVYw7LnEjkiP9r",
  }),
}));

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
const ACTOR_ID = "user_test_payment_month";

d("paymentMonth survives the write-core", () => {
  const incomeIds: string[] = [];
  const expenseIds: string[] = [];
  sweepLeakedAuditRows(COOPER_CLIENT_ID);

  afterEach(async () => {
    for (const id of incomeIds.splice(0)) {
      await db.delete(incomes).where(eq(incomes.id, id));
    }
    for (const id of expenseIds.splice(0)) {
      await db.delete(expenses).where(eq(expenses.id, id));
    }
  });

  async function makeIncome(over: Record<string, unknown> = {}) {
    const res = await createIncomeForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        type: "salary",
        name: "Paid-in test income",
        annualAmount: 50000,
        startYear: 2025,
        endYear: 2035,
        owner: "client",
        ...over,
      },
    });
    if (res.ok) incomeIds.push(res.data.id);
    return res;
  }

  async function makeExpense(over: Record<string, unknown> = {}) {
    const res = await createExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        type: "other",
        name: "Paid-in test expense",
        annualAmount: 12000,
        startYear: 2025,
        endYear: 2035,
        ...over,
      },
    });
    if (res.ok) expenseIds.push(res.data.id);
    return res;
  }

  it("writes an income's month on create and moves it on edit", async () => {
    const created = await makeIncome({ paymentMonth: 6 });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.paymentMonth).toBe(6);

    const moved = await updateIncomeForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      incomeId: created.data.id,
      input: { paymentMonth: 11 },
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.data.paymentMonth).toBe(11);

    // "Monthly" is a real choice, not the absence of one: picking it back has to
    // clear the stored month rather than leave November behind.
    const cleared = await updateIncomeForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      incomeId: created.data.id,
      input: { paymentMonth: null },
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.data.paymentMonth).toBeNull();
  });

  // The load-bearing case for the `!== undefined` guard on both writers: a patch
  // that never mentions the month — every caller that edits some other field —
  // must not quietly reset a dated row to Monthly.
  it("leaves an income's stored month alone when the patch omits it", async () => {
    const created = await makeIncome({ paymentMonth: 3 });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const res = await updateIncomeForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      incomeId: created.data.id,
      input: { annualAmount: 61000 },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.paymentMonth).toBe(3);
  });

  it("writes an expense's month on create and moves it on edit", async () => {
    const created = await makeExpense({ paymentMonth: 4 });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.paymentMonth).toBe(4);

    const moved = await updateExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      expenseId: created.data.id,
      input: { paymentMonth: 12 },
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.data.paymentMonth).toBe(12);
  });

  it("leaves an expense's stored month alone when the patch omits it", async () => {
    const created = await makeExpense({ paymentMonth: 9 });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const res = await updateExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      expenseId: created.data.id,
      input: { annualAmount: 13000 },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.paymentMonth).toBe(9);
  });
});
