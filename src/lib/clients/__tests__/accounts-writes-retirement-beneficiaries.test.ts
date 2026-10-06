// src/lib/clients/__tests__/accounts-writes-retirement-beneficiaries.test.ts
//
// A new retirement account starts on the default beneficiaries (the other
// co-client primary, the children equally contingent), and an untouched
// default follows the account to a new owner. Mirrors the DB-test harness of
// accounts-writes-529.test.ts. Hits the real Neon dev branch and skips cleanly
// without a DB.
import { describe, it, expect, afterEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { sweepLeakedAuditRows } from "@/lib/audit/test-helpers";
import { accounts, beneficiaryDesignations } from "@/db/schema";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({
    userId: "user_test_account_ret_benes",
    orgRole: "org:admin",
    orgId: "org_3CitTEIe8PJa1BVYw7LnEjkiP9r",
  }),
}));

import { createAccountForClient, updateAccountForClient } from "../accounts-writes";

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
const ACTOR_ID = "user_test_account_ret_benes";

// Cooper household: the two co-clients and the two children.
const COOPER_FM_ID = "7f875f15-50f6-4ef2-8f18-8a0b1f8b3997";
const SUSAN_FM_ID = "700e50bc-9679-4aa5-b699-4afdd4064ca7";
const CHILD_IDS = ["ee579f90-cc1a-4fb1-8b9f-3861ef47ad3b", "b9d724dc-57b0-4167-9fe1-6f4b0b6f1741"];

const soleOwner = (familyMemberId: string) => [{ kind: "family_member", familyMemberId, percent: 1 }];

async function designationsOf(accountId: string) {
  const rows = await db
    .select()
    .from(beneficiaryDesignations)
    .where(eq(beneficiaryDesignations.accountId, accountId));
  return rows
    .map((r) => ({
      tier: r.tier,
      who: r.householdRole ?? r.familyMemberId,
      percentage: Number(r.percentage),
    }))
    .sort((a, b) => `${a.tier}${a.who}`.localeCompare(`${b.tier}${b.who}`));
}

const expected = (otherRole: "client" | "spouse") =>
  [
    { tier: "contingent", who: CHILD_IDS[0], percentage: 50 },
    { tier: "contingent", who: CHILD_IDS[1], percentage: 50 },
    { tier: "primary", who: otherRole, percentage: 100 },
  ].sort((a, b) => `${a.tier}${a.who}`.localeCompare(`${b.tier}${b.who}`));

d("accounts-writes core — default retirement beneficiaries", () => {
  const createdIds: string[] = [];
  sweepLeakedAuditRows(COOPER_CLIENT_ID);

  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      await db.delete(accounts).where(eq(accounts.id, id));
    }
  });

  async function createIra(ownerId: string) {
    const res = await createAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: { name: "Default-bene IRA", category: "retirement", subType: "traditional_ira", owners: soleOwner(ownerId) },
    });
    if (!res.ok) throw new Error(res.error);
    createdIds.push(res.data.id);
    return res.data.id;
  }

  const setOwner = (accountId: string, ownerId: string) =>
    updateAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      accountId,
      input: { owners: soleOwner(ownerId) },
    });

  it("client-owned IRA → spouse primary 100%, children contingent 50/50", async () => {
    const id = await createIra(COOPER_FM_ID);
    expect(await designationsOf(id)).toEqual(expected("spouse"));
  });

  it("spouse-owned IRA → client primary", async () => {
    const id = await createIra(SUSAN_FM_ID);
    expect(await designationsOf(id)).toEqual(expected("client"));
  });

  it("a taxable account gets no default beneficiaries", async () => {
    const res = await createAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: { name: "Brokerage", category: "taxable", owners: soleOwner(COOPER_FM_ID) },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    createdIds.push(res.data.id);
    expect(await designationsOf(res.data.id)).toEqual([]);
  });

  it("switching the owner re-points an untouched default at the new owner's spouse", async () => {
    const id = await createIra(COOPER_FM_ID);
    expect((await setOwner(id, SUSAN_FM_ID)).ok).toBe(true);
    expect(await designationsOf(id)).toEqual(expected("client"));
  });

  it("switching the owner leaves edited designations alone", async () => {
    const id = await createIra(COOPER_FM_ID);
    await db
      .update(beneficiaryDesignations)
      .set({ familyMemberId: CHILD_IDS[0], householdRole: null })
      .where(and(eq(beneficiaryDesignations.accountId, id), eq(beneficiaryDesignations.householdRole, "spouse")));
    const edited = await designationsOf(id);
    expect((await setOwner(id, SUSAN_FM_ID)).ok).toBe(true);
    expect(await designationsOf(id)).toEqual(edited);
  });
});
