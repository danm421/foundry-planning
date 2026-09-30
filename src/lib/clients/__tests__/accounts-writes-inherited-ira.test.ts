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

  // Spec Validation bullet 4: "heirDisabled is ignored (saved false) when the
  // death year is absent." Pinned at CREATE — no death/owner-birth year sent,
  // but heirDisabled ticked true. Deleting the create insert's
  // `p.inheritedDeathYear != null && ...` guard leaves every OTHER test in
  // this file green (none of them create a non-inherited account with
  // heirDisabled: true), so this is the only assertion that catches it.
  it("create ignores heirDisabled when no death year is set", async () => {
    const res = await createAccountForClient({
      clientId: COOPER_CLIENT_ID, firmId: COOPER_FIRM_ID, actorId: ACTOR_ID,
      input: {
        name: "Non-inherited IRA (test, heirDisabled ticked)", category: "retirement", subType: "traditional_ira",
        owners: OWNERS, inheritedHeirDisabled: true,
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    createdIds.push(res.data.id);
    expect(res.data.inheritedDeathYear).toBeNull();
    expect(res.data.inheritedOwnerBirthYear).toBeNull();
    expect(res.data.inheritedHeirDisabled).toBe(false);
  });

  it("update can un-inherit (all three back to null/false)", async () => {
    const created = await createInherited();
    if (!created.ok) throw new Error(created.error);
    // Precondition — without this, an already-broken create path (fields
    // never persisted) would make the un-inherit assertions below pass
    // vacuously (nulling already-null fields).
    expect(created.data.inheritedDeathYear).toBe(2022);
    expect(created.data.inheritedHeirDisabled).toBe(true);
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
    expect(res.error).toMatch(/Traditional or Roth IRA/);
  });

  // R1, key-present half: un-inheriting AND explicitly sending
  // inheritedHeirDisabled: true in the same payload must still save false.
  // (The other half — the key absent entirely — is the original R1 test below.)
  it("update un-inheriting while sending heirDisabled:true still saves heirDisabled=false", async () => {
    const created = await createInherited();
    if (!created.ok) throw new Error(created.error);
    const res = await updateAccountForClient({
      clientId: COOPER_CLIENT_ID, firmId: COOPER_FIRM_ID, actorId: ACTOR_ID, accountId: created.data.id,
      input: { inheritedDeathYear: null, inheritedOwnerBirthYear: null, inheritedHeirDisabled: true },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.inheritedDeathYear).toBeNull();
    expect(res.data.inheritedOwnerBirthYear).toBeNull();
    expect(res.data.inheritedHeirDisabled).toBe(false);
  });

  // Protective direction of R1: an unrelated update (no inherited-IRA keys in
  // the payload at all — e.g. an autosave that only touches `name`) must NOT
  // touch the death year, owner-birth year, or heirDisabled on an already-
  // inherited account. A naive R1 implementation that reads the raw
  // `safeUpdate.inheritedDeathYear` (undefined when the key is absent) instead
  // of resolving it against `before` would wrongly treat `undefined == null`
  // as "no death year" and wipe heirDisabled on every unrelated autosave —
  // silently moving the heir from the stretch schedule to the 10-year rule.
  it("update touching only an unrelated field leaves an inherited account's years and heirDisabled untouched", async () => {
    const created = await createInherited();
    if (!created.ok) throw new Error(created.error);
    const res = await updateAccountForClient({
      clientId: COOPER_CLIENT_ID, firmId: COOPER_FIRM_ID, actorId: ACTOR_ID, accountId: created.data.id,
      input: { name: "Inherited IRA (renamed)" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.name).toBe("Inherited IRA (renamed)");
    expect(res.data.inheritedDeathYear).toBe(2022);
    expect(res.data.inheritedOwnerBirthYear).toBe(1945);
    expect(res.data.inheritedHeirDisabled).toBe(true);
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
