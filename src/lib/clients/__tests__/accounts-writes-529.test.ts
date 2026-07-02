// src/lib/clients/__tests__/accounts-writes-529.test.ts
//
// 529 / education_savings write-path tests for the accounts write-core (Task
// 10): the beneficiary-required validation and the zero-account_owners-rows
// invariant. Mirrors the DB-test harness of accounts-writes.test.ts verbatim
// (Clerk mock, HAS_DB gate, Cooper client/family-member fixtures, id-tracked
// cleanup). Hits the real Neon dev branch and skips cleanly without a DB.
import { describe, it, expect, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, accountOwners } from "@/db/schema";

// verifyClientAccess (via authz.ts → staffMaySeeAdvisor) calls Clerk's auth(),
// which throws under vitest. Mock it to a firm-wide admin — see
// accounts-writes.test.ts for the full rationale.
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({
    userId: "user_test_account_529",
    orgRole: "org:admin",
    orgId: "org_3CitTEIe8PJa1BVYw7LnEjkiP9r",
  }),
}));

import { createAccountForClient, updateAccountForClient } from "../accounts-writes";

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
const ACTOR_ID = "user_test_account_529";

// Cooper "client" family member — real fixture, reused from accounts-writes.test.ts.
const COOPER_FM_ID = "7f875f15-50f6-4ef2-8f18-8a0b1f8b3997";

d("accounts-writes core — 529 / education_savings", () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    const ids = createdIds.splice(0);
    for (const id of ids.reverse()) {
      await db.delete(accounts).where(eq(accounts.id, id));
    }
  });

  it("create with beneficiaryFamilyMemberId → persists, zero account_owners rows", async () => {
    const res = await createAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        name: "529 for kid",
        category: "education_savings",
        beneficiaryFamilyMemberId: COOPER_FM_ID,
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return; // narrow for TS
    createdIds.push(res.data.id);

    expect(res.data.category).toBe("education_savings");
    expect(res.data.beneficiaryFamilyMemberId).toBe(COOPER_FM_ID);
    expect(res.data.beneficiaryName).toBeNull();
    expect(res.data.grantorFamilyMemberId).toBeNull();
    expect(res.data.grantorName).toBeNull();
    expect(res.data.rothRolloverEnabled).toBe(false);

    const owners = await db
      .select()
      .from(accountOwners)
      .where(eq(accountOwners.accountId, res.data.id));
    expect(owners.length).toBe(0);
  });

  it("create with neither beneficiary field → rejects with a validation error", async () => {
    const res = await createAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        name: "529 missing beneficiary",
        category: "education_savings",
      },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return; // narrow for TS
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/beneficiary/i);
  });

  it("create with grantorName: 'Grandma' → persists, grantorFamilyMemberId null", async () => {
    const res = await createAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        name: "529 funded by grandma",
        category: "education_savings",
        beneficiaryName: "Junior",
        grantorName: "Grandma",
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return; // narrow for TS
    createdIds.push(res.data.id);

    expect(res.data.grantorName).toBe("Grandma");
    expect(res.data.grantorFamilyMemberId).toBeNull();
    expect(res.data.beneficiaryName).toBe("Junior");

    const owners = await db
      .select()
      .from(accountOwners)
      .where(eq(accountOwners.accountId, res.data.id));
    expect(owners.length).toBe(0);
  });

  it("update: switching a taxable account into education_savings without a beneficiary is rejected", async () => {
    const created = await createAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: { name: "Plain taxable", category: "taxable" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdIds.push(created.data.id);

    const res = await updateAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      accountId: created.data.id,
      input: { category: "education_savings" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/beneficiary/i);
  });

  it("update: an existing 529 with owners rows written directly has them cleared on any update", async () => {
    const created = await createAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        name: "529 to be edited",
        category: "education_savings",
        beneficiaryFamilyMemberId: COOPER_FM_ID,
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdIds.push(created.data.id);

    // Simulate a legacy/stray owners row (the invariant should self-heal it).
    await db.insert(accountOwners).values({
      accountId: created.data.id,
      familyMemberId: COOPER_FM_ID,
      entityId: null,
      percent: "1",
    });

    const res = await updateAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      accountId: created.data.id,
      input: { name: "529 to be edited (renamed)" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const owners = await db
      .select()
      .from(accountOwners)
      .where(eq(accountOwners.accountId, created.data.id));
    expect(owners.length).toBe(0);
  });
});
