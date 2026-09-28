// Inherited-IRA write-path tests. Same harness as accounts-writes-529.test.ts:
// Clerk mock, HAS_DB gate, Cooper fixtures, id-tracked cleanup.
import { describe, it, expect, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sweepLeakedAuditRows } from "@/lib/audit/test-helpers";
import { accounts } from "@/db/schema";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({
    userId: "user_test_account_inherited",
    orgRole: "org:admin",
    orgId: "org_3CitTEIe8PJa1BVYw7LnEjkiP9r",
  }),
}));

import { createAccountForClient, updateAccountForClient } from "../accounts-writes";

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
const ACTOR_ID = "user_test_account_inherited";
const COOPER_FM_ID = "7f875f15-50f6-4ef2-8f18-8a0b1f8b3997";
const OWNERS = [{ kind: "family_member", familyMemberId: COOPER_FM_ID, percent: 1 }];

d("accounts-writes core — inherited IRA", () => {
  const createdIds: string[] = [];
  sweepLeakedAuditRows(COOPER_CLIENT_ID);

  afterEach(async () => {
    for (const id of createdIds.splice(0).reverse()) {
      await db.delete(accounts).where(eq(accounts.id, id));
    }
  });

  async function createInherited(extra: Record<string, unknown> = {}) {
    const res = await createAccountForClient({
      clientId: COOPER_CLIENT_ID, firmId: COOPER_FIRM_ID, actorId: ACTOR_ID,
      input: {
        name: "Inherited IRA (test)", category: "retirement", subType: "traditional_ira",
        owners: OWNERS, inheritedDeathYear: 2022, inheritedOwnerBirthYear: 1945,
        inheritedHeirDisabled: true, ...extra,
      },
    });
    if (res.ok) createdIds.push(res.data.id);
    return res;
  }

  it("create persists all three fields", async () => {
    const res = await createInherited();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.inheritedDeathYear).toBe(2022);
    expect(res.data.inheritedOwnerBirthYear).toBe(1945);
    expect(res.data.inheritedHeirDisabled).toBe(true);
  });

  it("create rejects half a pair with a 400", async () => {
    const res = await createInherited({ inheritedOwnerBirthYear: null });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/both the year of death/);
  });

  it("create rejects the fields on a 401(k)", async () => {
    const res = await createInherited({ subType: "401k" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/Traditional or Roth IRA/);
  });

  it("update can un-inherit (all three back to null/false)", async () => {
    const created = await createInherited();
    if (!created.ok) throw new Error(created.error);
    const res = await updateAccountForClient({
      clientId: COOPER_CLIENT_ID, firmId: COOPER_FIRM_ID, actorId: ACTOR_ID, accountId: created.data.id,
      input: { inheritedDeathYear: null, inheritedOwnerBirthYear: null, inheritedHeirDisabled: false },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.inheritedDeathYear).toBeNull();
    expect(res.data.inheritedOwnerBirthYear).toBeNull();
    expect(res.data.inheritedHeirDisabled).toBe(false);
  });

  it("update rejects switching an inherited account to a 401(k) without clearing the fields", async () => {
    const created = await createInherited();
    if (!created.ok) throw new Error(created.error);
    const res = await updateAccountForClient({
      clientId: COOPER_CLIENT_ID, firmId: COOPER_FIRM_ID, actorId: ACTOR_ID, accountId: created.data.id,
      input: { subType: "401k" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  // Ruling R1: the spec's "heirDisabled is ignored (saved false) when the death
  // year is absent" applies on UPDATE too, not just create. Update an account
  // that has NO death year with inheritedHeirDisabled: true → must save false,
  // even though the caller sent true and nothing else in the payload disagrees.
  it("R1: update saves heirDisabled=false when the resulting death year is null", async () => {
    const created = await createAccountForClient({
      clientId: COOPER_CLIENT_ID, firmId: COOPER_FIRM_ID, actorId: ACTOR_ID,
      input: {
        name: "Non-inherited IRA (test)", category: "retirement", subType: "traditional_ira",
        owners: OWNERS,
      },
    });
    if (!created.ok) throw new Error(created.error);
    createdIds.push(created.data.id);
    expect(created.data.inheritedDeathYear).toBeNull();

    const res = await updateAccountForClient({
      clientId: COOPER_CLIENT_ID, firmId: COOPER_FIRM_ID, actorId: ACTOR_ID, accountId: created.data.id,
      input: { inheritedHeirDisabled: true },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.inheritedHeirDisabled).toBe(false);
  });
});
