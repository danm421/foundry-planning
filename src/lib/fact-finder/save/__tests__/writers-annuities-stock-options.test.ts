// src/lib/fact-finder/save/__tests__/writers-annuities-stock-options.test.ts
//
// Live dev database: the annuity contract and stock option save writers on a
// real transaction (Plan 4, Task 6). Every body comes from payloadFor over a
// change line built the way the review builds one. The annuity account a
// contract hangs off is inserted straight onto the transaction here — making
// the accounts core join the save is another task's. Everything lives under a
// firm id no other suite uses.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_ff_save", orgId: "firm_test_ff_save_annuities", orgRole: "org:admin" }),
}));

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  accountOwners,
  accounts,
  annuityContracts,
  auditLog,
  familyMembers,
  stockOptionAccounts,
  stockOptionGrants,
  stockOptionPlannedEvents,
  stockOptionVestTranches,
} from "@/db/schema";
import type { RecordRef, TargetKind } from "@/lib/fact-finder/change-set";
import { SaveLineError } from "../types";
import { ACCOUNT_WRITERS } from "../writers/accounts";
import { ANNUITY_STOCK_WRITERS } from "../writers/annuities-stock-options";
import { SAVE_ACTOR, changeLine, dropSaveFirm, inSave, inputOf, seedSaveClient, type SaveSeed } from "./harness";

const FIRM = "firm_test_ff_save_annuities";
const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const { annuity_contract: contracts, stock_option_account: optionAccounts, stock_option_grant: grants } = ANNUITY_STOCK_WRITERS;
const rollback = { rollback: true };
const record = (target: TargetKind, id: string): RecordRef => ({ ref: "record", target, id });
const CLIENT: RecordRef = { ref: "person", role: "client" };
const FOUR_VESTS = [
  { vestDate: "2025-03-01", shares: 250 },
  { vestDate: "2026-03-01", shares: 250 },
  { vestDate: "2027-03-01", shares: 250 },
  { vestDate: "2028-03-01", shares: 250 },
];

let seed: SaveSeed;

d("annuity contract and stock option save writers", () => {
  beforeAll(async () => {
    await dropSaveFirm(FIRM);
    seed = await seedSaveClient(FIRM);
  });
  afterAll(() => dropSaveFirm(FIRM));
  const at = () => ({ clientId: seed.clientId, firmId: FIRM });

  async function annuityAccount(name: string, subType: "qualified" | "non_qualified" = "non_qualified") {
    const [row] = await db
      .insert(accounts)
      .values({ clientId: seed.clientId, scenarioId: seed.scenarioId, name, category: "annuity", subType, value: "120000" })
      .returning({ id: accounts.id });
    return row.id;
  }

  /** A stock option account on record, ticker HIST, with a 1,000-share RSU whose vest rows carry history, and a planned sale. */
  async function grantOnRecord(name: string) {
    const [account] = await db
      .insert(accounts)
      .values({ clientId: seed.clientId, scenarioId: seed.scenarioId, name, category: "stock_options", subType: "other", value: "0", basis: "0" })
      .returning({ id: accounts.id });
    await db.insert(stockOptionAccounts).values({ accountId: account.id, ticker: "HIST" });
    const [grant] = await db
      .insert(stockOptionGrants)
      .values({ accountId: account.id, grantNumber: "G-1", grantType: "rsu", grantDate: "2024-03-01", sharesGranted: "1000", notes: "Refresh grant" })
      .returning({ id: stockOptionGrants.id });
    await db.insert(stockOptionVestTranches).values([
      { grantId: grant.id, vestDate: "2025-03-01", shares: "250", sharesSold: "100", acquiredOn: "2025-03-01", priceAtAcquisition: "40", sortOrder: 0 },
      { grantId: grant.id, vestDate: "2026-03-01", shares: "250", sortOrder: 1 },
      { grantId: grant.id, vestDate: "2027-03-01", shares: "500", sellTiming: "hold", sortOrder: 2 },
    ]);
    await db.insert(stockOptionPlannedEvents).values({ grantId: grant.id, year: 2030, action: "sell", pct: "0.5" });
    return { accountId: account.id, grantId: grant.id };
  }

  /** Save by save; within one save by action — its rows share created_at (the transaction's start), so their own order isn't kept. */
  const auditOf = (resourceIds: string[]) =>
    db
      .select({ action: auditLog.action, actorId: auditLog.actorId, resourceId: auditLog.resourceId })
      .from(auditLog)
      .where(and(eq(auditLog.clientId, seed.clientId), inArray(auditLog.resourceId, resourceIds)))
      .orderBy(asc(auditLog.createdAt), asc(auditLog.action));
  const auditCount = async () => (await db.select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.clientId, seed.clientId))).length;
  const contractOf = async (accountId: string) => (await db.select().from(annuityContracts).where(eq(annuityContracts.accountId, accountId)))[0];
  const tranchesOf = (grantId: string) =>
    db.select().from(stockOptionVestTranches).where(eq(stockOptionVestTranches.grantId, grantId)).orderBy(asc(stockOptionVestTranches.sortOrder));

  it("(a, e) an annuity contract Create then Update commit, each with its audit row; nothing is queued", async () => {
    const accountId = await annuityAccount("Jackson MYGA");
    const created = await inSave(at(), (ctx) =>
      contracts.create(ctx, inputOf(changeLine("annuity_contract", { costBasis: 100000, productType: "myga", incomeMode: "none" }, { parent: record("account", accountId) }))),
    );
    expect(created.result).toBe(accountId);
    const updated = await inSave(at(), (ctx) =>
      contracts.update(ctx, inputOf(changeLine("annuity_contract", { payoutStructure: "single_life" }, { recordId: accountId, parent: record("account", accountId) }))),
    );
    expect([created.queued, updated.queued]).toEqual([0, 0]);

    expect(await contractOf(accountId)).toMatchObject({
      costBasis: "100000.00",
      productType: "myga",
      incomeMode: "none",
      payoutStructure: "single_life",
      taxTreatment: "non_qualified",
    });
    expect(await auditOf([accountId])).toEqual([
      { action: "account.annuity.update", actorId: SAVE_ACTOR, resourceId: accountId },
      { action: "account.annuity.update", actorId: SAVE_ACTOR, resourceId: accountId },
    ]);
  });

  it("(a, e) a stock option account and a grant, Create then Update, commit with their audit rows; nothing is queued", async () => {
    const accountLine = changeLine("stock_option_account", { name: "Acme Corp", ticker: "ACME", owner: "client" });
    const first = await inSave(at(), (ctx) => optionAccounts.create(ctx, inputOf(accountLine)));
    const accountId = first.result;
    const grantLine = changeLine(
      "stock_option_grant",
      { grantType: "rsu", grantNumber: "R-100", grantDate: "2024-03-01", sharesGranted: 1000, tranches: FOUR_VESTS },
      { parent: record("stock_option_account", accountId) },
    );
    const second = await inSave(at(), (ctx) => grants.create(ctx, inputOf(grantLine)));
    const grantId = second.result;
    const third = await inSave(at(), async (ctx) => {
      await optionAccounts.update(ctx, inputOf(changeLine("stock_option_account", { ticker: "ACMX" }, { recordId: accountId })));
      await grants.update(
        ctx,
        inputOf(changeLine("stock_option_grant", { grantNumber: "R-101" }, { recordId: grantId, parent: record("stock_option_account", accountId) })),
      );
    });
    expect([first.queued, second.queued, third.queued]).toEqual([0, 0, 0]);

    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    expect(account).toMatchObject({ clientId: seed.clientId, scenarioId: seed.scenarioId, name: "Acme Corp", category: "stock_options" });
    const [extension] = await db.select().from(stockOptionAccounts).where(eq(stockOptionAccounts.accountId, accountId));
    expect(extension.ticker).toBe("ACMX");
    const owners = await db.select().from(accountOwners).where(eq(accountOwners.accountId, accountId));
    expect(owners.map((o) => [o.familyMemberId, o.percent])).toEqual([[seed.clientMemberId, "1.0000"]]);
    const [grant] = await db.select().from(stockOptionGrants).where(eq(stockOptionGrants.id, grantId));
    expect(grant).toMatchObject({ accountId, grantType: "rsu", grantNumber: "R-101", grantDate: "2024-03-01" });
    expect((await tranchesOf(grantId)).map((t) => [t.vestDate, Number(t.shares)])).toEqual(FOUR_VESTS.map((t) => [t.vestDate, t.shares]));

    expect(await auditOf([accountId, grantId])).toEqual([
      { action: "account.stock_options.create", actorId: SAVE_ACTOR, resourceId: accountId },
      { action: "account.stock_options.grant.create", actorId: SAVE_ACTOR, resourceId: grantId },
      { action: "account.stock_options.grant.update", actorId: SAVE_ACTOR, resourceId: grantId },
      { action: "account.stock_options.update", actorId: SAVE_ACTOR, resourceId: accountId },
    ]);
  });

  it("(b) every write rolls back with the save — no row, no audit row, records as they were", async () => {
    const annuityId = await annuityAccount("Rollback MYGA");
    const onRecord = await grantOnRecord("Rollback Holdings");
    const before = await auditCount();
    const { result } = await inSave(
      at(),
      async (ctx) => {
        await contracts.create(ctx, inputOf(changeLine("annuity_contract", { costBasis: 50000 }, { parent: record("account", annuityId) })));
        const accountLine = changeLine("stock_option_account", { name: "Rollback Co", owner: "client" });
        const accountId = await optionAccounts.create(ctx, inputOf(accountLine));
        const grantLine = changeLine(
          "stock_option_grant",
          { grantType: "rsu", grantDate: "2024-03-01", sharesGranted: 1000, tranches: FOUR_VESTS },
          { parent: { ref: "line", target: "stock_option_account", lineId: accountLine.id } },
        );
        const grantId = await grants.create(ctx, inputOf(grantLine, { [`line:${accountLine.id}`]: accountId }));
        await optionAccounts.update(ctx, inputOf(changeLine("stock_option_account", { ticker: "ROLL" }, { recordId: onRecord.accountId })));
        await grants.update(
          ctx,
          inputOf(changeLine("stock_option_grant", { grantNumber: "ROLLED" }, { recordId: onRecord.grantId, parent: record("stock_option_account", onRecord.accountId) })),
        );
        return { accountId, grantId };
      },
      rollback,
    );

    expect(await contractOf(annuityId)).toBeUndefined();
    expect(await db.select().from(accounts).where(eq(accounts.id, result.accountId))).toEqual([]);
    expect(await db.select().from(stockOptionGrants).where(eq(stockOptionGrants.id, result.grantId))).toEqual([]);
    const [extension] = await db.select().from(stockOptionAccounts).where(eq(stockOptionAccounts.accountId, onRecord.accountId));
    expect(extension.ticker).toBe("HIST");
    const [grant] = await db.select().from(stockOptionGrants).where(eq(stockOptionGrants.id, onRecord.grantId));
    expect(grant.grantNumber).toBe("G-1");
    expect(await auditCount()).toBe(before);
  });

  it("(c) a contract on an annuity account created earlier in the save takes its tax treatment from that account's sub-type", async () => {
    const accountLine = changeLine("account", { name: "Pacific IRA Annuity" }, { fixed: { category: "annuity", subType: "qualified" } });
    const contractLine = changeLine(
      "annuity_contract",
      { costBasis: 0, productType: "fixed_indexed", incomeMode: "none" },
      { parent: { ref: "line", target: "account", lineId: accountLine.id } },
    );
    const { result: accountId } = await inSave(at(), async (ctx) => {
      const [account] = await ctx.tx
        .insert(accounts)
        .values({ clientId: seed.clientId, scenarioId: seed.scenarioId, name: "Pacific IRA Annuity", category: "annuity", subType: "qualified", value: "80000" })
        .returning({ id: accounts.id });
      expect(await contracts.create(ctx, inputOf(contractLine, { [`line:${accountLine.id}`]: account.id }))).toBe(account.id);
      return account.id;
    });
    // The body carries no tax treatment, and the schema's default is non-qualified: the new account's sub-type set it.
    expect(await contractOf(accountId)).toMatchObject({ productType: "fixed_indexed", costBasis: "0.00", taxTreatment: "qualified" });
  });

  it("(c) a grant on a stock option account created earlier in the save", async () => {
    const accountLine = changeLine("stock_option_account", { name: "Globex", ticker: "GBX", owner: "client" });
    const grantLine = changeLine(
      "stock_option_grant",
      { grantType: "nqso", grantDate: "2023-06-15", sharesGranted: 1000, strikePrice: 12.5, expirationDate: "2033-06-15", tranches: FOUR_VESTS },
      { parent: { ref: "line", target: "stock_option_account", lineId: accountLine.id } },
    );
    const { result } = await inSave(at(), async (ctx) => {
      const accountId = await optionAccounts.create(ctx, inputOf(accountLine));
      const grantId = await grants.create(ctx, inputOf(grantLine, { [`line:${accountLine.id}`]: accountId }));
      return { accountId, grantId };
    });
    const [grant] = await db.select().from(stockOptionGrants).where(eq(stockOptionGrants.id, result.grantId));
    expect(grant).toMatchObject({ accountId: result.accountId, grantType: "nqso", strikePrice: "12.5000", expirationDate: "2033-06-15" });
    expect(await tranchesOf(result.grantId)).toHaveLength(4);
  });

  it("(c) a stock option account held by the co-client a household line added earlier in the save", async () => {
    const { result } = await inSave(
      at(),
      async (ctx) => {
        // As the household writer leaves it: the co-client's family member, on the transaction.
        const [laura] = await ctx.tx
          .insert(familyMembers)
          .values({ clientId: seed.clientId, firstName: "Laura", lastName: "Hendricks", role: "spouse", relationship: "other", dateOfBirth: "1970-09-30" })
          .returning({ id: familyMembers.id });
        const accountId = await optionAccounts.create(ctx, inputOf(changeLine("stock_option_account", { name: "Initech", owner: "spouse" })));
        const owners = await ctx.tx.select().from(accountOwners).where(eq(accountOwners.accountId, accountId));
        return { laura: laura.id, owners: owners.map((o) => o.familyMemberId) };
      },
      rollback,
    );
    expect(result.owners).toEqual([result.laura]);
  });

  it("(c) a stock option account on record moved to the co-client a household line added earlier in the save", async () => {
    const { result: accountId } = await inSave(at(), (ctx) => optionAccounts.create(ctx, inputOf(changeLine("stock_option_account", { name: "Acme Options", owner: "client" }))));
    const { result } = await inSave(
      at(),
      async (ctx) => {
        const [laura] = await ctx.tx
          .insert(familyMembers)
          .values({ clientId: seed.clientId, firstName: "Laura", lastName: "Hendricks", role: "spouse", relationship: "other", dateOfBirth: "1970-09-30" })
          .returning({ id: familyMembers.id });
        await optionAccounts.update(ctx, inputOf(changeLine("stock_option_account", { owner: "spouse" }, { recordId: accountId })));
        const owners = await ctx.tx.select().from(accountOwners).where(eq(accountOwners.accountId, accountId));
        return { laura: laura.id, owners: owners.map((o) => o.familyMemberId) };
      },
      rollback,
    );
    expect(result.owners).toEqual([result.laura]);
  });

  it("(d) an annuity account changed to Qualified with no contract line: its contract follows the account, as the Details form re-saves it", async () => {
    const accountId = await annuityAccount("Lincoln MYGA");
    await db.insert(annuityContracts).values({ accountId, carrier: "Lincoln", productType: "myga", taxTreatment: "non_qualified", costBasis: "90000" });
    const toQualified = changeLine("account", { subType: "qualified" }, { recordId: accountId });

    await inSave(at(), (ctx) => ACCOUNT_WRITERS.account.update(ctx, inputOf(toQualified)));
    expect(await contractOf(accountId)).toMatchObject({ taxTreatment: "qualified", carrier: "Lincoln", productType: "myga", costBasis: "90000.00" });
    expect((await auditOf([accountId])).map((a) => a.action)).toEqual(["account.annuity.update", "account.update"]);

    // An account line that leaves the tax treatment alone leaves the contract alone.
    await inSave(at(), (ctx) => ACCOUNT_WRITERS.account.update(ctx, inputOf(changeLine("account", { value: 125000 }, { recordId: accountId }))));
    expect((await auditOf([accountId])).map((a) => a.action)).toEqual(["account.annuity.update", "account.update", "account.update"]);
  });

  it("(d) a new qualified annuity with no contract line gets a contract that taxes it as qualified", async () => {
    const line = changeLine(
      "account",
      { name: "Pacific IRA Annuity", value: 80000, subType: "qualified", owners: [{ who: CLIENT, percent: 1 }] },
      { fixed: { category: "annuity" } },
    );
    const { result: accountId } = await inSave(at(), (ctx) => ACCOUNT_WRITERS.account.create(ctx, inputOf(line, { "person:client": seed.clientMemberId })));
    expect(await contractOf(accountId)).toMatchObject({ taxTreatment: "qualified", productType: "fixed", incomeMode: "none", costBasis: null });
    expect((await auditOf([accountId])).map((a) => a.action)).toEqual(["account.annuity.update", "account.create"]);
  });

  it("(d) a new annuity and its contract line in one save: the contract line's values over the synced contract", async () => {
    const accountLine = changeLine(
      "account",
      { name: "Nationwide Roth Annuity", value: 60000, subType: "tax_free", owners: [{ who: CLIENT, percent: 1 }] },
      { fixed: { category: "annuity" } },
    );
    const contractLine = changeLine(
      "annuity_contract",
      { costBasis: 40000, productType: "variable" },
      { parent: { ref: "line", target: "account", lineId: accountLine.id } },
    );
    const { result: accountId } = await inSave(at(), async (ctx) => {
      const id = await ACCOUNT_WRITERS.account.create(ctx, inputOf(accountLine, { "person:client": seed.clientMemberId }));
      await contracts.create(ctx, inputOf(contractLine, { [`line:${accountLine.id}`]: id }));
      return id;
    });
    expect(await contractOf(accountId)).toMatchObject({ taxTreatment: "tax_free", productType: "variable", costBasis: "40000.00" });
  });

  it("(d) a new account that isn't an annuity gets no contract", async () => {
    const line = changeLine("account", { name: "Plain Brokerage", value: 1000, owners: [{ who: CLIENT, percent: 1 }] }, { fixed: { category: "taxable" } });
    const { result: accountId } = await inSave(at(), (ctx) => ACCOUNT_WRITERS.account.create(ctx, inputOf(line, { "person:client": seed.clientMemberId })));
    expect(await contractOf(accountId)).toBeUndefined();
  });

  it("(d) a contract Update keeps every column the line doesn't carry", async () => {
    const accountId = await annuityAccount("Allianz FIA");
    await db.insert(annuityContracts).values({
      accountId,
      carrier: "Allianz Life",
      contractNumberLast4: "4821",
      productType: "fixed_indexed",
      taxTreatment: "non_qualified",
      costBasis: "90000",
      surrenderChargePct: "0.0600",
      surrenderEndYear: 2029,
      annualFeePct: "0.0125",
      incomeMode: "none",
      rollupRatchets: false,
      expectedReturnYears: "18.50",
    });
    await inSave(at(), (ctx) =>
      contracts.update(ctx, inputOf(changeLine("annuity_contract", { costBasis: 95000, productType: "myga" }, { recordId: accountId, parent: record("account", accountId) }))),
    );
    expect(await contractOf(accountId)).toMatchObject({
      costBasis: "95000.00",
      productType: "myga",
      carrier: "Allianz Life",
      contractNumberLast4: "4821",
      surrenderChargePct: "0.0600",
      surrenderEndYear: 2029,
      annualFeePct: "0.0125",
      incomeMode: "none",
      rollupRatchets: false,
      expectedReturnYears: "18.50",
    });
  });

  it("(d) a grant Update merges vest rows by date: a listed date takes the line's shares and keeps its history, a new date is added, the rest stays", async () => {
    const { accountId, grantId } = await grantOnRecord("Hooli");
    const line = changeLine(
      "stock_option_grant",
      { grantNumber: "G-1A", tranches: [{ vestDate: "2027-03-01", shares: 250 }, { vestDate: "2028-03-01", shares: 250 }] },
      { recordId: grantId, parent: record("stock_option_account", accountId) },
    );
    await inSave(at(), (ctx) => grants.update(ctx, inputOf(line)));

    const [grant] = await db.select().from(stockOptionGrants).where(eq(stockOptionGrants.id, grantId));
    expect(grant).toMatchObject({ grantNumber: "G-1A", grantType: "rsu", grantDate: "2024-03-01", sharesGranted: "1000.000000", notes: "Refresh grant" });
    const rows = (await tranchesOf(grantId)).map((t) => ({
      vestDate: t.vestDate,
      shares: Number(t.shares),
      sharesSold: Number(t.sharesSold),
      acquiredOn: t.acquiredOn,
      priceAtAcquisition: t.priceAtAcquisition === null ? null : Number(t.priceAtAcquisition),
      sellTiming: t.sellTiming,
    }));
    expect(rows).toEqual([
      { vestDate: "2025-03-01", shares: 250, sharesSold: 100, acquiredOn: "2025-03-01", priceAtAcquisition: 40, sellTiming: null },
      { vestDate: "2026-03-01", shares: 250, sharesSold: 0, acquiredOn: null, priceAtAcquisition: null, sellTiming: null },
      { vestDate: "2027-03-01", shares: 250, sharesSold: 0, acquiredOn: null, priceAtAcquisition: null, sellTiming: "hold" },
      { vestDate: "2028-03-01", shares: 250, sharesSold: 0, acquiredOn: null, priceAtAcquisition: null, sellTiming: null },
    ]);
    const events = await db.select().from(stockOptionPlannedEvents).where(eq(stockOptionPlannedEvents.grantId, grantId));
    expect(events.map((e) => [e.year, e.action, Number(e.pct)])).toEqual([[2030, "sell", 0.5]]);
  });

  it("(d) a merged grant whose vest rows no longer add up is refused with the reason, and nothing is written", async () => {
    const { accountId, grantId } = await grantOnRecord("Pied Piper");
    const line = changeLine(
      "stock_option_grant",
      { tranches: [{ vestDate: "2025-06-01", shares: 500 }, { vestDate: "2026-06-01", shares: 500 }] },
      { recordId: grantId, parent: record("stock_option_account", accountId) },
    );
    const save = inSave(at(), (ctx) => grants.update(ctx, inputOf(line)));
    await expect(save).rejects.toThrow(SaveLineError);
    await expect(save).rejects.toThrow("tranches: Vesting tranches total 2000 of 1000 shares granted.");
    expect((await tranchesOf(grantId)).map((t) => t.vestDate)).toEqual(["2025-03-01", "2026-03-01", "2027-03-01"]);
  });
});
