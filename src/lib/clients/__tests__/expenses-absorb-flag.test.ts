import { describe, it, expect, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { expenses } from "@/db/schema";
import { sweepLeakedAuditRows } from "@/lib/audit/test-helpers";
import { createExpenseForClient, updateExpenseForClient } from "../expenses-writes";

// Same mock as expenses-writes.test.ts: org:admin is not a STAFF_ROLE, so the
// staff-scope check short-circuits and access reduces to DB firm membership.
// vi.mock is hoisted above the consts below, so the orgId literal is inlined.
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({
    userId: "user_test_absorb_flag",
    orgRole: "org:admin",
    orgId: "org_3CitTEIe8PJa1BVYw7LnEjkiP9r",
  }),
}));

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
const ACTOR_ID = "user_test_absorb_flag";

d("expenses-writes — absorbsRemainingCashFlow", () => {
  const createdIds: string[] = [];
  sweepLeakedAuditRows(COOPER_CLIENT_ID);

  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      await db.delete(expenses).where(eq(expenses.id, id));
    }
  });

  async function makeLiving(over: Record<string, unknown> = {}) {
    const res = await createExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        type: "living",
        name: "Absorb test living",
        annualAmount: 0,
        startYear: 2030,
        endYear: 2040,
        ...over,
      },
    });
    if (res.ok) createdIds.push(res.data.id);
    return res;
  }

  it("persists the flag on a living row", async () => {
    const res = await makeLiving({ absorbsRemainingCashFlow: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.absorbsRemainingCashFlow).toBe(true);
  });

  it("rejects the flag on a non-living row", async () => {
    const res = await createExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        type: "other",
        name: "Absorb test other",
        annualAmount: 0,
        startYear: 2030,
        endYear: 2040,
        absorbsRemainingCashFlow: true,
      },
    });
    // Track BEFORE asserting: if the guard regresses, the row really is created,
    // and an assertion that throws first would leak it onto the dev household.
    if (res.ok) { createdIds.push(res.data.id); }
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    expect(res.error).toBe("Only living expenses can spend the remaining cash flow.");
  });

  it("rejects a SECOND absorbing row and names the one that already has it", async () => {
    const first = await makeLiving({
      name: "Absorb test first",
      absorbsRemainingCashFlow: true,
    });
    expect(first.ok).toBe(true);

    const second = await makeLiving({
      name: "Absorb test second",
      absorbsRemainingCashFlow: true,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.status).toBe(400);
    expect(second.error).toContain("Absorb test first");
  });

  it("lets the absorbing row re-save itself", async () => {
    // The load-bearing case. A guard written as "does ANY absorbing row exist"
    // instead of "does any OTHER absorbing row exist" passes every test above
    // and makes the row permanently unsaveable.
    const created = await makeLiving({ absorbsRemainingCashFlow: true });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const res = await updateExpenseForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      expenseId: created.data.id,
      input: { absorbsRemainingCashFlow: true, annualAmount: 5000 },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.absorbsRemainingCashFlow).toBe(true);
  });
});
