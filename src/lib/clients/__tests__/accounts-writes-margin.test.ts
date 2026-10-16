// Margin-loan write-path tests. Same harness as accounts-writes-inherited-ira.test.ts:
// Clerk mock, HAS_DB gate, Cooper fixtures, id-tracked cleanup.
import { describe, it, expect, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sweepLeakedAuditRows } from "@/lib/audit/test-helpers";
import { accounts } from "@/db/schema";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({
    userId: "user_test_account_margin",
    orgRole: "org:admin",
    orgId: "org_3CitTEIe8PJa1BVYw7LnEjkiP9r",
  }),
}));

import { createAccountForClient, updateAccountForClient } from "../accounts-writes";

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
const ACTOR_ID = "user_test_account_margin";
const COOPER_FM_ID = "7f875f15-50f6-4ef2-8f18-8a0b1f8b3997";
const OWNERS = [{ kind: "family_member", familyMemberId: COOPER_FM_ID, percent: 1 }];

d("accounts-writes core — margin loan", () => {
  const createdIds: string[] = [];
  sweepLeakedAuditRows(COOPER_CLIENT_ID);

  afterEach(async () => {
    for (const id of createdIds.splice(0).reverse()) {
      await db.delete(accounts).where(eq(accounts.id, id));
    }
  });

  async function createMargined(extra: Record<string, unknown> = {}) {
    const res = await createAccountForClient({
      clientId: COOPER_CLIENT_ID, firmId: COOPER_FIRM_ID, actorId: ACTOR_ID,
      input: {
        name: "Margin Brokerage (test)", category: "taxable", subType: "brokerage",
        value: "10000000", marginBalance: "2000000", marginInterestRate: "0.02",
        owners: OWNERS, ...extra,
      },
    });
    if (res.ok) createdIds.push(res.data.id);
    return res;
  }

  it("create persists the three fields", async () => {
    const res = await createMargined();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [row] = await db.select().from(accounts).where(eq(accounts.id, res.data.id));
    expect(Number(row.marginBalance)).toBe(2_000_000);
    expect(Number(row.marginInterestRate)).toBe(0.02);
    expect(Number(row.marginCallPct)).toBe(0.3);
  });

  it("create rejects a loan >= value with a 400", async () => {
    const res = await createMargined({ marginBalance: "10000000" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it("update rejects lowering value below the loan", async () => {
    const res = await createMargined();
    if (!res.ok) throw new Error("setup");
    const up = await updateAccountForClient({
      clientId: COOPER_CLIENT_ID, firmId: COOPER_FIRM_ID, actorId: ACTOR_ID, accountId: res.data.id,
      input: { value: "1000000" },
    });
    expect(up.ok).toBe(false);
    if (up.ok) return;
    expect(up.status).toBe(400);
  });

  it("update rejects changing category away from taxable while a loan exists (R8)", async () => {
    const res = await createMargined();
    if (!res.ok) throw new Error("setup");
    const up = await updateAccountForClient({
      clientId: COOPER_CLIENT_ID, firmId: COOPER_FIRM_ID, actorId: ACTOR_ID, accountId: res.data.id,
      input: { category: "cash", subType: "checking" },
    });
    expect(up.ok).toBe(false);
    if (up.ok) return;
    expect(up.error).toMatch(/Remove the margin loan/);
  });

  it("create persists the borrowing fields", async () => {
    const res = await createMargined({ marginBorrowEnabled: true, marginBorrowStartYear: 2030,
      marginBorrowStartYearRef: "client_retirement", marginRepayYear: 2036 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [row] = await db.select().from(accounts).where(eq(accounts.id, res.data.id));
    expect(row.marginBorrowEnabled).toBe(true);
    expect(row.marginBorrowStartYear).toBe(2030);
    expect(row.marginBorrowStartYearRef).toBe("client_retirement");
    expect(row.marginRepayYear).toBe(2036);
    expect(row.marginRepayYearRef).toBeNull();
  });

  it("update rejects moving a borrowing account off taxable with a 400", async () => {
    const res = await createMargined({ marginBalance: "0", marginBorrowEnabled: true });
    if (!res.ok) throw new Error("setup");
    const up = await updateAccountForClient({
      clientId: COOPER_CLIENT_ID, firmId: COOPER_FIRM_ID, actorId: ACTOR_ID, accountId: res.data.id,
      input: { category: "cash", subType: "checking" },
    });
    expect(up.ok).toBe(false);
    if (up.ok) return;
    expect(up.error).toMatch(/Turn off borrowing/);
  });
});
