// src/lib/fact-finder/save/__tests__/writers-accounts.test.ts
//
// Live dev database: the fact finder save's account and business writers
// (Plan 4, Task 2). Each body comes from payloadFor over a change line built
// the way the review builds one; each save runs on a real transaction that
// commits or rolls back. The records a line names — a new family member, a
// new trust, a co-client the household line adds — are written earlier on the
// same transaction, so the account write path must read them there.
// Everything lives under a firm id no other suite uses.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_ff_save", orgId: "firm_test_ff_save_accounts", orgRole: "org:admin" }),
}));
// The asset-mix roll-up reads on module `db`, so the save queues it for after the commit. Mocked to see when it runs.
vi.mock("@/lib/investments/sync-account-from-holdings", () => ({ syncAccountFromHoldings: vi.fn(async () => {}) }));
// Pricing calls the network; resolveSaveHoldings' own job is choosing the tickers.
vi.mock("@/lib/imports/commit/holdings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/imports/commit/holdings")>()),
  resolveTickers: vi.fn(async () => new Map()),
}));

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  accountHoldings,
  accountOwners,
  accounts,
  assetClasses,
  auditLog,
  beneficiaryDesignations,
  entities,
  familyMembers,
  holdingAssetClassOverrides,
  securities,
} from "@/db/schema";
import { createAccountForClient, updateAccountForClient } from "@/lib/clients/accounts-writes";
import { resolveTickers } from "@/lib/imports/commit/holdings";
import type { ResolvedHoldingsMap } from "@/lib/imports/commit/types";
import { syncAccountFromHoldings } from "@/lib/investments/sync-account-from-holdings";
import type { PlacedValue, RecordRef } from "../../change-set";
import { ACCOUNT_WRITERS, resolveSaveHoldings } from "../writers/accounts";
import { SAVE_ACTOR, changeLine, dropSaveFirm, inSave, inputOf, seedSaveClient, type SaveSeed } from "./harness";

const FIRM = "firm_test_ff_save_accounts";
const TICKER = "FFSAVEACCT";
const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const CLIENT: RecordRef = { ref: "person", role: "client" };
const SPOUSE: RecordRef = { ref: "person", role: "spouse" };
const TRUST_LINE: RecordRef = { ref: "line", target: "entity", lineId: "trusts-1/entity" };
const CHILD_LINE: RecordRef = { ref: "line", target: "family_member", lineId: "family-1/family_member" };
const solely = (who: RecordRef) => [{ who, percent: 1 }];

let seed: SaveSeed;
let securityId: string;

/** The account as the plan holds it now. */
async function accountRow(id: string) {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, id));
  return row;
}

async function ownersOf(accountId: string) {
  const rows = await db.select().from(accountOwners).where(eq(accountOwners.accountId, accountId));
  return rows.map((o) => ({ familyMemberId: o.familyMemberId, entityId: o.entityId, percent: Number(o.percent) }));
}

/** An account on the plan before the save, made the way Details makes one. */
async function accountOnPlan(clientId: string, memberId: string, input: Record<string, unknown>): Promise<string> {
  const made = await createAccountForClient({
    clientId,
    firmId: FIRM,
    actorId: SAVE_ACTOR,
    input: { category: "taxable", owners: [{ kind: "family_member", familyMemberId: memberId, percent: 1 }], ...input },
  });
  if (!made.ok) throw new Error(made.error);
  return made.data.id;
}

d("account and business writers (live dev database)", () => {
  beforeAll(async () => {
    await dropSaveFirm(FIRM);
    await db.delete(securities).where(and(eq(securities.identifierType, "ticker"), eq(securities.identifier, TICKER)));
    [{ id: securityId }] = await db
      .insert(securities)
      .values({ identifierType: "ticker", identifier: TICKER, name: "Fact Finder Save Test Fund", securityType: "etf", classifierSource: "manual" })
      .returning({ id: securities.id });
    seed = await seedSaveClient(FIRM, { coClient: true });
  });
  afterAll(async () => {
    await dropSaveFirm(FIRM);
    await db.delete(securities).where(eq(securities.id, securityId));
  });
  const at = (s: { clientId: string } = seed) => ({ clientId: s.clientId, firmId: FIRM });
  const people = () => ({ "person:client": seed.clientMemberId, "person:spouse": seed.spouseMemberId! });

  it("(a) creates and updates an account and a business in a save that commits, each with its audit row", async () => {
    const brokerage = changeLine(
      "account",
      { name: "Schwab Brokerage", value: 120000, accountNumberLast4: "4417", custodian: "Schwab", subType: "brokerage", owners: solely(CLIENT), basis: 90000 },
      { fixed: { category: "taxable" } },
    );
    const design = changeLine(
      "business_account",
      { name: "Hendricks Design LLC", businessType: "llc", value: 400000, basis: 50000, owners: solely(CLIENT) },
      { fixed: { category: "business" } },
    );
    const { result: ids } = await inSave(at(), async (ctx) => ({
      account: await ACCOUNT_WRITERS.account.create(ctx, inputOf(brokerage, people())),
      business: await ACCOUNT_WRITERS.business_account.create(ctx, inputOf(design, people())),
    }));

    const rename = changeLine("account", { name: "Schwab Joint Brokerage", value: 125000 }, { recordId: ids.account });
    const revalue = changeLine("business_account", { value: 450000 }, { recordId: ids.business });
    await inSave(at(), async (ctx) => {
      await ACCOUNT_WRITERS.account.update(ctx, inputOf(rename));
      await ACCOUNT_WRITERS.business_account.update(ctx, inputOf(revalue));
    });

    const account = await accountRow(ids.account);
    expect(account).toMatchObject({ clientId: seed.clientId, scenarioId: seed.scenarioId, name: "Schwab Joint Brokerage", category: "taxable", subType: "brokerage", custodian: "Schwab", accountNumberLast4: "4417" });
    expect([Number(account.value), Number(account.basis)]).toEqual([125000, 90000]);
    expect(await ownersOf(ids.account)).toEqual([{ familyMemberId: seed.clientMemberId, entityId: null, percent: 1 }]);
    const business = await accountRow(ids.business);
    expect(business).toMatchObject({ name: "Hendricks Design LLC", category: "business", businessType: "llc", subType: "llc" });
    expect(Number(business.value)).toBe(450000);

    const audit = await db
      .select({ action: auditLog.action, resourceId: auditLog.resourceId, actorId: auditLog.actorId, clientId: auditLog.clientId, firmId: auditLog.firmId })
      .from(auditLog)
      .where(inArray(auditLog.resourceId, [ids.account, ids.business]));
    const row = (action: string, resourceId: string) => ({ action, resourceId, actorId: SAVE_ACTOR, clientId: seed.clientId, firmId: FIRM });
    expect(audit).toHaveLength(4);
    expect(audit).toEqual(
      expect.arrayContaining([
        row("account.create", ids.account),
        row("account.update", ids.account),
        row("account.create", ids.business),
        row("account.update", ids.business),
      ]),
    );
  });

  it("(b) the same in a save that rolls back leaves no row and no audit row", async () => {
    const own = await seedSaveClient(FIRM);
    const onPlan = await accountOnPlan(own.clientId, own.clientMemberId, { name: "Vanguard Brokerage" });
    const ids = { "person:client": own.clientMemberId };
    const brokerage = changeLine("account", { name: "Schwab Brokerage", value: 120000, owners: solely(CLIENT) }, { fixed: { category: "taxable" } });
    const design = changeLine(
      "business_account",
      { name: "Rollback Design LLC", businessType: "llc", value: 400000, basis: 50000, owners: solely(CLIENT) },
      { fixed: { category: "business" } },
    );

    const { result } = await inSave(
      at(own),
      async (ctx) => {
        const account = await ACCOUNT_WRITERS.account.create(ctx, inputOf(brokerage, ids));
        const business = await ACCOUNT_WRITERS.business_account.create(ctx, inputOf(design, ids));
        await ACCOUNT_WRITERS.account.update(ctx, inputOf(changeLine("account", { name: "Vanguard Joint Brokerage" }, { recordId: onPlan })));
        // A record made earlier in the same save.
        await ACCOUNT_WRITERS.account.update(ctx, inputOf(changeLine("account", { value: 125000 }, { recordId: account })));
        return { account, business };
      },
      { rollback: true },
    );

    expect(await db.select().from(accounts).where(inArray(accounts.id, [result.account, result.business]))).toEqual([]);
    const names = await db.select({ name: accounts.name }).from(accounts).where(eq(accounts.clientId, own.clientId)).orderBy(asc(accounts.name));
    expect(names.map((a) => a.name)).toEqual(["Household Cash", "Vanguard Brokerage"]);
    const audit = await db.select({ action: auditLog.action, resourceId: auditLog.resourceId }).from(auditLog).where(eq(auditLog.clientId, own.clientId));
    expect(audit).toEqual([{ action: "account.create", resourceId: onPlan }]);
  });

  it("(c) accounts owned by a family member and by a trust, both created earlier in the save — new and on record", async () => {
    const onPlan = await accountOnPlan(seed.clientId, seed.clientMemberId, { name: "Morgan Stanley Brokerage" });
    const utma = changeLine("account", { name: "Emma's UTMA", subType: "brokerage", owners: solely(CHILD_LINE) }, { fixed: { category: "taxable" } });
    const trustAccount = changeLine("account", { name: "Family Trust Brokerage", owners: solely(TRUST_LINE) }, { fixed: { category: "taxable" } });
    const retitled = changeLine("account", { owners: solely(TRUST_LINE) }, { recordId: onPlan });
    expect(utma.dependsOn).toEqual([CHILD_LINE.lineId]);

    const { result } = await inSave(at(), async (ctx) => {
      const [child] = await ctx.tx.insert(familyMembers).values({ clientId: seed.clientId, firstName: "Emma", lastName: "Hendricks", role: "child", relationship: "child" }).returning();
      const [trust] = await ctx.tx.insert(entities).values({ clientId: seed.clientId, name: "Hendricks Family Trust" }).returning();
      const ids = { [`line:${CHILD_LINE.lineId}`]: child.id, [`line:${TRUST_LINE.lineId}`]: trust.id };
      await ACCOUNT_WRITERS.account.update(ctx, inputOf(retitled, ids));
      return {
        child: child.id,
        trust: trust.id,
        utma: await ACCOUNT_WRITERS.account.create(ctx, inputOf(utma, ids)),
        trustAccount: await ACCOUNT_WRITERS.account.create(ctx, inputOf(trustAccount, ids)),
      };
    });

    expect(await ownersOf(result.utma)).toEqual([{ familyMemberId: result.child, entityId: null, percent: 1 }]);
    expect(await ownersOf(result.trustAccount)).toEqual([{ familyMemberId: null, entityId: result.trust, percent: 1 }]);
    expect(await ownersOf(onPlan)).toEqual([{ familyMemberId: null, entityId: result.trust, percent: 1 }]);
  });

  it("(c) a retirement account owned by a co-client added earlier in the save starts on the household's default beneficiaries", async () => {
    const single = await seedSaveClient(FIRM);
    const ira = changeLine(
      "account",
      { name: "Laura's IRA", subType: "traditional_ira", owners: solely(SPOUSE) },
      { fixed: { category: "retirement" } },
    );

    const { result } = await inSave(at(single), async (ctx) => {
      // What the household line writes when it adds the co-client (Task 5), and a child from the Family page.
      const [laura] = await ctx.tx
        .insert(familyMembers)
        .values({ clientId: single.clientId, firstName: "Laura", lastName: "Hendricks", role: "spouse", relationship: "other", dateOfBirth: "1970-09-30" })
        .returning();
      const [emma] = await ctx.tx
        .insert(familyMembers)
        .values({ clientId: single.clientId, firstName: "Emma", lastName: "Hendricks", role: "child", relationship: "child", dateOfBirth: "2004-05-01" })
        .returning();
      return { emma: emma.id, ira: await ACCOUNT_WRITERS.account.create(ctx, inputOf(ira, { "person:spouse": laura.id })) };
    });

    const designations = await db
      .select({ tier: beneficiaryDesignations.tier, householdRole: beneficiaryDesignations.householdRole, familyMemberId: beneficiaryDesignations.familyMemberId, percentage: beneficiaryDesignations.percentage })
      .from(beneficiaryDesignations)
      .where(eq(beneficiaryDesignations.accountId, result.ira))
      .orderBy(asc(beneficiaryDesignations.tier));
    expect(designations.map((r) => ({ ...r, percentage: Number(r.percentage) }))).toEqual([
      { tier: "primary", householdRole: "client", familyMemberId: null, percentage: 100 },
      { tier: "contingent", householdRole: null, familyMemberId: result.emma, percentage: 100 },
    ]);
  });

  it("(c) a business owned in part by a trust created earlier in the save gets its own cash account", async () => {
    const design = changeLine(
      "business_account",
      { name: "Hendricks Studio LLC", businessType: "llc", value: 300000, basis: 20000, owners: [{ who: CLIENT, percent: 0.6 }, { who: TRUST_LINE, percent: 0.4 }] },
      { fixed: { category: "business" } },
    );

    const { result } = await inSave(at(), async (ctx) => {
      const [trust] = await ctx.tx.insert(entities).values({ clientId: seed.clientId, name: "Studio Trust" }).returning();
      const business = await ACCOUNT_WRITERS.business_account.create(ctx, inputOf(design, { ...people(), [`line:${TRUST_LINE.lineId}`]: trust.id }));
      const cash = await ctx.tx.select().from(accounts).where(eq(accounts.parentAccountId, business));
      return { business, trust: trust.id, cash };
    });

    expect(result.cash).toHaveLength(1);
    expect(result.cash[0]).toMatchObject({ name: "Hendricks Studio LLC — Cash", category: "cash", subType: "checking", isDefaultChecking: true });
    expect(await ownersOf(result.business)).toEqual(
      expect.arrayContaining([
        { familyMemberId: seed.clientMemberId, entityId: null, percent: 0.6 },
        { familyMemberId: null, entityId: result.trust, percent: 0.4 },
      ]),
    );
  });

  it("(d) a new property's address — which the create schema drops — is saved; an update's goes through the account update", async () => {
    const home = changeLine(
      "account",
      { name: "Home", subType: "primary_residence", value: 850000, propertyAddress: "1420 Larimer St, Denver, CO", owners: solely(CLIENT) },
      { fixed: { category: "real_estate" } },
    );
    const { result: id } = await inSave(at(), (ctx) => ACCOUNT_WRITERS.account.create(ctx, inputOf(home, people())));
    expect(await accountRow(id)).toMatchObject({ name: "Home", category: "real_estate", propertyAddress: "1420 Larimer St, Denver, CO" });

    const moved = changeLine("account", { propertyAddress: "1430 Larimer St, Denver, CO" }, { recordId: id });
    await inSave(at(), (ctx) => ACCOUNT_WRITERS.account.update(ctx, inputOf(moved)));
    expect((await accountRow(id)).propertyAddress).toBe("1430 Larimer St, Denver, CO");
  });

  it("(d)(e) a new account's positions: the priced ticker, the value derived from them, the roll-up after the commit, cost basis kept on the positions", async () => {
    const positions: PlacedValue = [
      { ticker: TICKER, name: "Test Fund", shares: 10, price: 100, marketValue: 1000, costBasis: 800 },
      { ticker: null, name: "Cash", shares: null, price: null, marketValue: 500, costBasis: 500 },
    ];
    const brokerage = changeLine(
      "account",
      { name: "Fidelity Brokerage", value: 1500, basis: 2000, owners: solely(CLIENT), holdings: positions },
      { fixed: { category: "taxable" } },
    );
    const priced: ResolvedHoldingsMap = new Map([[TICKER, { securityId, price: 101.5, asOf: "2026-10-14" }]]);
    vi.mocked(syncAccountFromHoldings).mockClear();

    const save = await inSave(at(), (ctx) => ACCOUNT_WRITERS.account.create({ ...ctx, holdings: priced }, inputOf(brokerage, people())));
    const id = save.result;
    expect(syncAccountFromHoldings).not.toHaveBeenCalled();
    expect(save.queued).toBe(1);

    const held = await db.select().from(accountHoldings).where(eq(accountHoldings.accountId, id)).orderBy(asc(accountHoldings.sortOrder));
    expect(
      held.map((h) => ({
        ticker: h.displayTicker, name: h.displayName, securityId: h.securityId, shares: Number(h.shares), price: Number(h.price),
        priceAsOf: h.priceAsOf, marketValue: h.marketValue === null ? null : Number(h.marketValue), costBasis: Number(h.costBasis),
      })),
    ).toEqual([
      { ticker: TICKER, name: "Test Fund", securityId, shares: 10, price: 101.5, priceAsOf: "2026-10-14", marketValue: null, costBasis: 800 },
      { ticker: null, name: "Cash", securityId: null, shares: 500, price: 1, priceAsOf: null, marketValue: 500, costBasis: 500 },
    ]);
    const account = await accountRow(id);
    expect(account.deriveFromHoldings).toBe(true);
    expect(account.notes).toBeNull();
    // The positions' cost basis ($1,300) never becomes the account's basis.
    expect(Number(account.basis)).toBe(2000);

    await save.flush();
    expect(syncAccountFromHoldings).toHaveBeenCalledTimes(1);
    expect(syncAccountFromHoldings).toHaveBeenCalledWith(id);
  });

  it("(d) the line's merged positions are written one by one — updated in place, added, never deleted; positions well short of the stated value keep the value and say so", async () => {
    const id = await accountOnPlan(seed.clientId, seed.clientMemberId, { name: "Edward Jones Brokerage", value: 50000 });
    await db.update(accounts).set({ notes: "Rebalanced in 2025." }).where(eq(accounts.id, id));
    const [fund, bond, other, unnamed] = await db
      .insert(accountHoldings)
      .values([
        { accountId: id, securityId, displayTicker: TICKER, shares: "4", price: "100", priceAsOf: "2026-09-30", costBasis: "300", sortOrder: 0, notes: "Bought in 2019" },
        { accountId: id, displayTicker: "OLDB", shares: "2", price: "25", priceAsOf: "2026-09-30", costBasis: "40", sortOrder: 1 },
        { accountId: id, displayTicker: "OLDC", shares: "1", price: "10", costBasis: "10", sortOrder: 2 },
        { accountId: id, marketValue: "75", costBasis: "0", sortOrder: 2 },
      ])
      .returning();
    const [largeCap] = await db.insert(assetClasses).values({ firmId: FIRM, name: "US Large Cap" }).returning();
    await db.insert(holdingAssetClassOverrides).values({ holdingId: fund.id, assetClassId: largeCap.id, weight: "1.0000" });
    // The review's merge (Plan 3): the fund's shares changed, the bond and the unnamed position kept as the book reads
    // them, a new cash position appended. OLDC isn't listed — it can't happen after a merge, but it mustn't be lost.
    const merged: PlacedValue = [
      { ticker: TICKER, name: null, shares: 5, price: 100, marketValue: 500, costBasis: 300 },
      { ticker: "OLDB", name: null, shares: 2, price: 25, marketValue: 50, costBasis: 40 },
      { ticker: null, name: null, shares: null, price: null, marketValue: 75, costBasis: 0 },
      { ticker: null, name: "Cash", shares: null, price: null, marketValue: 900, costBasis: 900 },
    ];
    const line = changeLine("account", { holdings: merged }, { recordId: id });
    const priced: ResolvedHoldingsMap = new Map([[TICKER, { securityId, price: 101.5, asOf: "2026-10-14" }]]);

    const save = await inSave(at(), (ctx) => ACCOUNT_WRITERS.account.update({ ...ctx, holdings: priced }, inputOf(line)));

    const held = await db.select().from(accountHoldings).where(eq(accountHoldings.accountId, id)).orderBy(asc(accountHoldings.sortOrder), asc(accountHoldings.displayTicker));
    const byId = new Map(held.map((h) => [h.id, h]));
    expect(held).toHaveLength(5);
    for (const kept of [fund, bond, other, unnamed]) expect(byId.has(kept.id)).toBe(true);
    expect(byId.get(fund.id)).toMatchObject({ securityId, shares: "5.000000", price: "101.5000", priceAsOf: "2026-10-14", marketValue: null, costBasis: "300.00", notes: "Bought in 2019" });
    expect(byId.get(bond.id)).toMatchObject({ shares: "2.000000", price: "25.0000", priceAsOf: "2026-09-30", marketValue: null, costBasis: "40.00" });
    expect(byId.get(other.id)).toMatchObject({ displayTicker: "OLDC", shares: "1.000000", price: "10.0000", updatedAt: other.updatedAt });
    expect(byId.get(unnamed.id)).toMatchObject({ marketValue: "75.00", updatedAt: unnamed.updatedAt });
    const cash = held.find((h) => h.displayName === "Cash");
    expect(cash).toMatchObject({ securityId: null, shares: "900.000000", price: "1.0000", marketValue: "900.00", costBasis: "900.00", sortOrder: 3 });
    expect(await db.select({ holdingId: holdingAssetClassOverrides.holdingId }).from(holdingAssetClassOverrides).where(eq(holdingAssetClassOverrides.assetClassId, largeCap.id))).toEqual([{ holdingId: fund.id }]);

    const account = await accountRow(id);
    expect(Number(account.value)).toBe(50000);
    expect(account.deriveFromHoldings).toBe(false);
    expect(account.notes).toBe("Rebalanced in 2025.\n⚠ Holdings $1,525 below stated $50,000 on import — value preserved, not derived from holdings.");
    // Queued like every account whose positions were written; the roll-up itself skips an account that doesn't derive.
    expect(save.queued).toBe(1);
  });

  it("(e) an update that turns on derive-from-holdings queues the core's roll-up for after the commit", async () => {
    const id = await accountOnPlan(seed.clientId, seed.clientMemberId, { name: "Merrill Brokerage" });
    vi.mocked(syncAccountFromHoldings).mockClear();

    const save = await inSave(at(), (ctx) =>
      updateAccountForClient({ clientId: seed.clientId, firmId: FIRM, actorId: SAVE_ACTOR, accountId: id, input: { deriveFromHoldings: true }, tx: ctx.tx, afterCommit: ctx.afterCommit }),
    );
    expect(save.result.ok).toBe(true);
    expect(syncAccountFromHoldings).not.toHaveBeenCalled();
    expect(save.queued).toBe(1);
    await save.flush();
    expect(syncAccountFromHoldings).toHaveBeenCalledWith(id);
  });

  it("prices each ticker the planned account lines name, once, before the save", async () => {
    const priced: ResolvedHoldingsMap = new Map([["VTI", { securityId, price: 290.12, asOf: "2026-10-14" }]]);
    vi.mocked(resolveTickers).mockClear();
    vi.mocked(resolveTickers).mockResolvedValueOnce(priced);
    const lines = [
      changeLine("account", {
        name: "Schwab Brokerage",
        holdings: [{ ticker: " vti ", name: null, shares: 3, price: 290, marketValue: 870, costBasis: null }, { ticker: null, name: "Cash", shares: null, price: null, marketValue: 40, costBasis: null }],
      }),
      changeLine("account", { name: "Schwab IRA", holdings: [{ ticker: "VTI", name: null, shares: 1, price: 290, marketValue: 290, costBasis: null }, { ticker: "bnd", name: null, shares: 2, price: 72, marketValue: 144, costBasis: null }] }),
      changeLine("account", { name: "Chase Checking", value: 12000 }),
    ];

    expect(await resolveSaveHoldings(lines.map((line) => ({ line, values: inputOf(line).values })))).toBe(priced);
    expect(resolveTickers).toHaveBeenCalledTimes(1);
    expect(resolveTickers).toHaveBeenCalledWith(["VTI", "BND"]);
  });
});
