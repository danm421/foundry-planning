import { describe, it, expect, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { expenses } from "@/db/schema";
import { sweepLeakedAuditRows } from "@/lib/audit/test-helpers";
import { createExpenseForClient, updateExpenseForClient } from "../expenses-writes";

// Same mock as expenses-absorb-flag.test.ts: org:admin is not a STAFF_ROLE, so
// access reduces to DB firm membership. vi.mock is hoisted, so the orgId is inlined.
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({
    userId: "user_test_living_items",
    orgRole: "org:admin",
    orgId: "org_3CitTEIe8PJa1BVYw7LnEjkiP9r",
  }),
}));

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
const ACTOR_ID = "user_test_living_items";

const HOUSING = { id: "i-housing", name: "Housing", amount: 3200, frequency: "monthly" };
const TRAVEL = { id: "i-travel", name: "Travel", amount: 12000, frequency: "annual" };

d("expenses-writes — livingItems", () => {
  const createdIds: string[] = [];
  sweepLeakedAuditRows(COOPER_CLIENT_ID);

  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      await db.delete(expenses).where(eq(expenses.id, id));
    }
  });

  async function create(input: Record<string, unknown>) {
    const res = await createExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        type: "living",
        name: "Living items test",
        annualAmount: 0,
        startYear: 2030,
        endYear: 2040,
        ...input,
      },
    });
    if (res.ok) createdIds.push(res.data.id);
    return res;
  }

  function update(expenseId: string, input: Record<string, unknown>) {
    return updateExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      expenseId,
      input,
    });
  }

  it("stores items on create and sets the total to their sum", async () => {
    const res = await create({ livingItems: [HOUSING, TRAVEL], annualAmount: 1 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.livingItems).toEqual([HOUSING, TRAVEL]);
    expect(Number(res.data.annualAmount)).toBe(50400);
  });

  it("recomputes the total on an items update, ignoring a disagreeing amount", async () => {
    const made = await create({ livingItems: [HOUSING] });
    if (!made.ok) throw new Error(made.error);
    const res = await update(made.data.id, { livingItems: [HOUSING, TRAVEL], annualAmount: "5" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Number(res.data.annualAmount)).toBe(50400);
  });

  it("leaves items alone when only the total is written — the outside total wins", async () => {
    const made = await create({ livingItems: [HOUSING, TRAVEL] });
    if (!made.ok) throw new Error(made.error);
    const res = await update(made.data.id, { annualAmount: "90000" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Number(res.data.annualAmount)).toBe(90000);
    expect(res.data.livingItems).toEqual([HOUSING, TRAVEL]);
  });

  it("stores an emptied list as null and keeps the caller's total", async () => {
    const made = await create({ livingItems: [HOUSING] });
    if (!made.ok) throw new Error(made.error);
    const res = await update(made.data.id, { livingItems: [], annualAmount: "0" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.livingItems).toBeNull();
    expect(Number(res.data.annualAmount)).toBe(0);
  });

  it("refuses items on a non-living row, on create and on update", async () => {
    const created = await create({ type: "other", livingItems: [HOUSING] });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.status).toBe(400);
    expect(created.error).toBe("Only living expenses can be itemized.");

    const other = await create({ type: "other" });
    if (!other.ok) throw new Error(other.error);
    const res = await update(other.data.id, { livingItems: [HOUSING] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("Only living expenses can be itemized.");
  });
});
