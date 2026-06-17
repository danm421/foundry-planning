// src/lib/clients/__tests__/accounts-writes.test.ts
//
// Core write tests for the accounts write-core — mirrors liabilities-writes.test.ts
// with account-specific adjustments: the business pre-branch + auto-provisioned
// child default-checking cash account, the isDefaultChecking system-managed guards
// (update + delete), and the deriveFromHoldings post-commit sync. Hits the real Neon
// dev branch and skips cleanly without a DB so it never adds to the no-delta failing
// set in CI.
import { describe, it, expect, afterEach, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { accounts, modelPortfolios } from "@/db/schema";

// verifyClientAccess (via authz.ts → staffMaySeeAdvisor) calls Clerk's auth(),
// which throws under vitest. Mock it to a firm-wide admin: org:admin is not a
// STAFF_ROLE, so the staff-scope check short-circuits true and access reduces to
// the DB firm-membership check. recordCreate/Update/Delete get actorId explicitly
// from the core, so they never read auth() here.
vi.mock("@clerk/nextjs/server", () => ({
  // orgId must equal COOPER_FIRM_ID so the real verifyClientAccess own-firm path
  // (`client.firmId === orgId`) matches and the write-core gate `a.firmId !== firmId`
  // passes. vi.mock is hoisted above the COOPER_FIRM_ID const, so inline the literal.
  auth: async () => ({
    userId: "user_test_account_core",
    orgRole: "org:admin",
    orgId: "org_3CitTEIe8PJa1BVYw7LnEjkiP9r",
  }),
}));

// syncAccountFromHoldings is mocked so the deriveFromHoldings post-commit-sync test
// can assert it was invoked without standing up a holdings fixture. Every other test
// path never sets deriveFromHoldings:true, so the real (DB-touching) implementation
// is irrelevant to them and the mock is a harmless no-op there.
vi.mock("@/lib/investments/sync-account-from-holdings", () => ({
  syncAccountFromHoldings: vi.fn(async () => {}),
}));

import { syncAccountFromHoldings } from "@/lib/investments/sync-account-from-holdings";
import {
  createAccountForClient,
  updateAccountForClient,
  deleteAccountForClient,
} from "../accounts-writes";

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
const ACTOR_ID = "user_test_account_core";

// Cooper "client" family member — used for the business owners[] happy path.
const COOPER_FM_ID = "7f875f15-50f6-4ef2-8f18-8a0b1f8b3997";
// Cooper "Home" account (real_estate, NOT business) — proves the non-business
// parentAccountId 400 path.
const COOPER_NONBUSINESS_ACCOUNT_ID = "573b1c44-067d-4112-aa90-762af7a0c55f";
// A random uuid that is NOT a model portfolio in this firm — proves the cross-firm
// modelPortfolioId 400 path.
const RANDOM_UUID = "00000000-0000-4000-8000-000000000000";

d("accounts-writes core", () => {
  // Every account id we create (including the auto-provisioned child cash). The
  // child cash references the parent via parent_account_id ON DELETE SET NULL — it
  // does NOT cascade — so cleanup must delete children explicitly. We track every
  // id we mint and also sweep any account whose parent_account_id points at one of
  // ours, then delete ids in reverse order (children before parents).
  const createdIds: string[] = [];

  afterEach(async () => {
    const ids = createdIds.splice(0);
    // Sweep auto-provisioned children (parentAccountId → one of our ids) that we
    // didn't track explicitly. account_owners cascades on account delete.
    for (const id of ids) {
      const children = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.parentAccountId, id));
      for (const c of children) {
        await db.delete(accounts).where(eq(accounts.id, c.id));
      }
    }
    // Delete in reverse insertion order so any remaining child precedes its parent.
    for (const id of ids.reverse()) {
      await db.delete(accounts).where(eq(accounts.id, id));
    }
  });

  it("create investment happy → {ok, data, resourceId === data.id} + defaults land", async () => {
    const res = await createAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: { name: "Core test account", category: "taxable" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return; // narrow for TS
    createdIds.push(res.data.id);
    expect(res.resourceId).toBe(res.data.id);
    expect(res.data.name).toBe("Core test account");
    expect(res.data.category).toBe("taxable");
    // Schema defaults round-trip.
    expect(res.data.subType).toBe("other");
    // decimal(15,2) "0" → "0.00".
    expect(res.data.value).toBe("0.00");
    expect(res.data.basis).toBe("0.00");
    expect(res.data.rothValue).toBe("0.00");
    expect(res.data.growthSource).toBe("default");
    expect(res.data.titlingType).toBe("jtwros");
    expect(res.data.isDefaultChecking).toBe(false);
    // Empty-string custodian / last4 collapse to null (the `|| null` Task 13 deferred).
    expect(res.data.custodian).toBeNull();
    expect(res.data.accountNumberLast4).toBeNull();
  });

  it("create business → {ok:true} and a child default-checking cash account is auto-provisioned", async () => {
    const res = await createAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        name: "Core test business",
        category: "business",
        businessType: "llc",
        value: 100000,
        basis: 50000,
        owners: [{ kind: "family_member", familyMemberId: COOPER_FM_ID, percent: 1 }],
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    createdIds.push(res.data.id);

    expect(res.data.category).toBe("business");
    expect(res.data.businessType).toBe("llc");
    // subType derived from businessType via mapBusinessTypeToSubType.
    expect(res.data.subType).toBe("llc");
    expect(res.data.value).toBe("100000.00");
    expect(res.data.basis).toBe("50000.00");
    // business-only defaults.
    expect(res.data.flowMode).toBe("annual");
    expect(res.data.businessTaxTreatment).toBe("qbi");

    // Auto-provisioned child default-checking cash account exists.
    const children = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.parentAccountId, res.data.id),
          eq(accounts.isDefaultChecking, true),
        ),
      );
    expect(children.length).toBe(1);
    expect(children[0].category).toBe("cash");
    expect(children[0].subType).toBe("checking");
    expect(children[0].name).toBe("Core test business — Cash");
  });

  it("create with cross-firm modelPortfolioId → {ok:false, status:400} + no row written", async () => {
    const res = await createAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        name: "Cross-firm MP account",
        category: "taxable",
        modelPortfolioId: RANDOM_UUID,
      },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    // No row written.
    const rows = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.modelPortfolioId, RANDOM_UUID));
    expect(rows.length).toBe(0);
  });

  it("create with a non-business parentAccountId → {ok:false, status:400} matching /business/i", async () => {
    const res = await createAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        name: "Non-business parent",
        category: "taxable",
        parentAccountId: COOPER_NONBUSINESS_ACCOUNT_ID,
      },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/business/i);
  });

  it("create with parentAccountId AND owners[] → {ok:false, status:400} (mutual exclusion)", async () => {
    // First create a real business to use as a valid (business) parent so the
    // parent-business check passes and we reach the mutual-exclusion guard.
    const biz = await createAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        name: "Mutual-exclusion parent biz",
        category: "business",
        businessType: "llc",
        value: 10,
        basis: 0,
        owners: [{ kind: "family_member", familyMemberId: COOPER_FM_ID, percent: 1 }],
      },
    });
    expect(biz.ok).toBe(true);
    if (!biz.ok) return;
    createdIds.push(biz.data.id);

    const res = await createAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        name: "Parent + owners",
        category: "taxable",
        parentAccountId: biz.data.id,
        owners: [{ kind: "family_member", familyMemberId: COOPER_FM_ID, percent: 1 }],
      },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/both a parent business and explicit owners/i);
  });

  it("update happy → {ok, data} with changed field, others untouched", async () => {
    const created = await createAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: { name: "Update target", category: "taxable", value: 1000 },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdIds.push(created.data.id);

    const res = await updateAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      accountId: created.data.id,
      input: { value: "2500" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.resourceId).toBe(created.data.id);
    expect(res.data.value).toBe("2500.00");
    // Untouched fields preserved.
    expect(res.data.name).toBe("Update target");
    expect(res.data.category).toBe("taxable");
  });

  it("update of a system-managed default-checking child cash → {ok:false, status:400} matching /system-managed/i", async () => {
    // Create a business so its child cash (isDefaultChecking) exists.
    const biz = await createAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        name: "Guard biz update",
        category: "business",
        businessType: "llc",
        value: 1,
        basis: 0,
        owners: [{ kind: "family_member", familyMemberId: COOPER_FM_ID, percent: 1 }],
      },
    });
    expect(biz.ok).toBe(true);
    if (!biz.ok) return;
    createdIds.push(biz.data.id);

    const [child] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(eq(accounts.parentAccountId, biz.data.id), eq(accounts.isDefaultChecking, true)),
      );
    expect(child).toBeTruthy();

    const res = await updateAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      accountId: child.id,
      input: { category: "taxable" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/system-managed/i);
  });

  it("delete of a system-managed default-checking child cash → {ok:false, status:400} matching /system-managed/i", async () => {
    const biz = await createAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: {
        name: "Guard biz delete",
        category: "business",
        businessType: "llc",
        value: 1,
        basis: 0,
        owners: [{ kind: "family_member", familyMemberId: COOPER_FM_ID, percent: 1 }],
      },
    });
    expect(biz.ok).toBe(true);
    if (!biz.ok) return;
    createdIds.push(biz.data.id);

    const [child] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(eq(accounts.parentAccountId, biz.data.id), eq(accounts.isDefaultChecking, true)),
      );
    expect(child).toBeTruthy();

    const res = await deleteAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      accountId: child.id,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/system-managed/i);

    // The child cash row must still exist (delete was rejected).
    const rows = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, child.id));
    expect(rows.length).toBe(1);
  });

  it("delete happy → create then delete returns {ok:true, data:{id}} and row is gone", async () => {
    const created = await createAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: { name: "Delete target", category: "taxable" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const accountId = created.data.id;
    // Do NOT push to createdIds — delete cleans it up.

    const res = await deleteAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      accountId,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual({ id: accountId });

    const rows = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    expect(rows.length).toBe(0);
  });

  it("update with deriveFromHoldings:true → invokes syncAccountFromHoldings post-commit", async () => {
    const created = await createAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: { name: "Derive sync target", category: "taxable" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdIds.push(created.data.id);

    vi.mocked(syncAccountFromHoldings).mockClear();

    const res = await updateAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      accountId: created.data.id,
      input: { deriveFromHoldings: true },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(syncAccountFromHoldings).toHaveBeenCalledWith(created.data.id);
    expect(syncAccountFromHoldings).toHaveBeenCalledTimes(1);
  });

  it("update WITHOUT deriveFromHoldings → does NOT invoke syncAccountFromHoldings", async () => {
    const created = await createAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      input: { name: "No-sync target", category: "taxable" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdIds.push(created.data.id);

    vi.mocked(syncAccountFromHoldings).mockClear();

    const res = await updateAccountForClient({
      clientId: COOPER_CLIENT_ID,
      firmId: COOPER_FIRM_ID,
      actorId: ACTOR_ID,
      accountId: created.data.id,
      input: { name: "No-sync target renamed" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(syncAccountFromHoldings).not.toHaveBeenCalled();
  });

  it("modelPortfolios fixture sanity: the firm has at least one (informational)", async () => {
    // Not load-bearing — documents that the cross-firm MP test relies on RANDOM_UUID
    // being absent, not on the firm having zero MPs.
    const rows = await db
      .select({ id: modelPortfolios.id })
      .from(modelPortfolios)
      .where(eq(modelPortfolios.firmId, COOPER_FIRM_ID))
      .limit(1);
    expect(Array.isArray(rows)).toBe(true);
  });
});
