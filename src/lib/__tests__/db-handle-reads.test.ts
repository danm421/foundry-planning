// src/lib/__tests__/db-handle-reads.test.ts
//
// Live dev database: why every read of the fact finder save runs on its
// transaction (Plan 4, D1). A row written earlier in an open transaction is
// invisible to a read on module `db` — another pooled connection — so a new
// house and then its mortgage was refused "not owned by this client", and an
// audit row outlived the rollback of the write it describes. Each check reads
// rows the transaction just wrote: on the transaction it sees them, without
// it it doesn't. Every transaction here rolls back. Then the save test
// harness itself. Everything lives under a firm id no other suite uses.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "user_test_ff_save" }) }));

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  assetClasses,
  auditLog,
  crmHouseholdContacts,
  entities,
  externalBeneficiaries,
  familyMembers,
  incomes,
  liabilities,
  modelPortfolios,
  notesReceivable,
  tickerPortfolios,
} from "@/db/schema";
import { recordCreate, recordDelete, recordUpdate } from "@/lib/audit";
import { toAccountSnapshot } from "@/lib/audit/snapshots/account";
import { toLiabilitySnapshot } from "@/lib/audit/snapshots/liability";
import { toNoteReceivableSnapshot } from "@/lib/audit/snapshots/note-receivable";
import { getClientWithContacts } from "@/lib/clients/get-client-with-contacts";
import {
  assertAccountsInClient,
  assertAssetClassesInFirm,
  assertBusinessAccountsInClient,
  assertEntitiesInClient,
  assertExternalBeneficiariesInClient,
  assertFamilyMembersInClient,
  assertIncomesInClient,
  assertLiabilitiesInClient,
  assertModelPortfoliosInFirm,
  assertRealEstateAccountsInClient,
  assertTickerPortfoliosInFirm,
  type FkCheck,
} from "@/lib/db-scoping";
import type { DbOrTx } from "@/lib/db-tx";
import { assertOwnerRefInClient } from "@/lib/insurance-policies/assert-owner-ref";
import { loadRiderLifePolicy } from "@/lib/insurance-policies/load-ltc-policies";
import { synthesizeLegacyAccountOwners, synthesizeLegacyLiabilityOwners, validateOwnersTenant, type ValidatedOwner } from "@/lib/ownership";
import { createTestClientWithScenario } from "@/test/factories";
import type { RecordRef } from "@/lib/fact-finder/change-set";
import { REF_YEAR, SAVE_ACTOR, changeLine, dropSaveFirm, inSave, inputOf, seedSaveClient, type SaveSeed } from "@/lib/fact-finder/save/__tests__/harness";

const FIRM = "firm_test_ff_save_handles";
const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

let seed: SaveSeed;
/** A client with no family members at all, for the reads that look up the client's own. */
let bare: { clientId: string; scenarioId: string };
const rollback = { rollback: true };

d("reads on a caller's transaction (D1)", () => {
  beforeAll(async () => {
    await dropSaveFirm(FIRM);
    seed = await seedSaveClient(FIRM);
    bare = await createTestClientWithScenario(FIRM);
  });
  afterAll(() => dropSaveFirm(FIRM));
  const at = () => ({ clientId: seed.clientId, firmId: FIRM });

  it("every assert sees a record written earlier in the transaction only when handed the transaction", async () => {
    await inSave(at(), async ({ tx }) => {
      const { clientId, scenarioId } = seed;
      const [child] = await tx.insert(familyMembers).values({ clientId, firstName: "Emma", lastName: "Hendricks", role: "child", relationship: "child" }).returning();
      const [trust] = await tx.insert(entities).values({ clientId, name: "Hendricks Family Trust" }).returning();
      const [charity] = await tx.insert(externalBeneficiaries).values({ clientId, name: "Denver Rescue Mission" }).returning();
      const [brokerage, business, house] = await tx
        .insert(accounts)
        .values([
          { clientId, scenarioId, name: "Schwab Brokerage", category: "taxable", subType: "brokerage" },
          { clientId, scenarioId, name: "Hendricks Design LLC", category: "business" },
          { clientId, scenarioId, name: "Home", category: "real_estate", subType: "primary_residence" },
        ])
        .returning();
      const [salary] = await tx.insert(incomes).values({ clientId, scenarioId, type: "salary", name: "Salary — Acme Corp", startYear: 2026, endYear: 2033 }).returning();
      const [mortgage] = await tx.insert(liabilities).values({ clientId, scenarioId, name: "Mortgage", startYear: 2020 }).returning();
      const [model] = await tx.insert(modelPortfolios).values({ firmId: FIRM, name: "Growth 80/20" }).returning();
      const [fund] = await tx.insert(tickerPortfolios).values({ firmId: FIRM, name: "Core ETFs" }).returning();
      const [assetClass] = await tx.insert(assetClasses).values({ firmId: FIRM, name: "US Large Cap" }).returning();

      const checks: [string, (handle?: DbOrTx) => Promise<FkCheck>, string][] = [
        ["accounts", (h) => assertAccountsInClient(clientId, [brokerage.id], h), `Account ${brokerage.id} not owned by this client`],
        ["business accounts", (h) => assertBusinessAccountsInClient(clientId, [business.id], h), `Account ${business.id} is not a business account`],
        ["incomes", (h) => assertIncomesInClient(clientId, [salary.id], h), `Income ${salary.id} not owned by this client`],
        ["liabilities", (h) => assertLiabilitiesInClient(clientId, [mortgage.id], h), `Liability ${mortgage.id} not owned by this client`],
        ["entities", (h) => assertEntitiesInClient(clientId, [trust.id], h), `Entity ${trust.id} not owned by this client`],
        ["family members", (h) => assertFamilyMembersInClient(clientId, [child.id], h), `Family member ${child.id} not owned by this client`],
        ["charities", (h) => assertExternalBeneficiariesInClient(clientId, [charity.id], h), `External beneficiary ${charity.id} not owned by this client`],
        ["model portfolios", (h) => assertModelPortfoliosInFirm(FIRM, [model.id], h), `Model portfolio ${model.id} not available to this firm`],
        ["fund portfolios", (h) => assertTickerPortfoliosInFirm(FIRM, [fund.id], h), `Fund portfolio ${fund.id} not available to this firm`],
        ["asset classes", (h) => assertAssetClassesInFirm(FIRM, [assetClass.id], h), `Asset class ${assetClass.id} not available to this firm`],
        ["real estate", (h) => assertRealEstateAccountsInClient(clientId, [house.id], h), `Account ${house.id} is not a real estate account`],
      ];
      for (const [name, check, reason] of checks) {
        expect(await check(tx), `${name}, on the transaction`).toEqual({ ok: true });
        expect(await check(), `${name}, without it`).toEqual({ ok: false, reason });
      }
    }, rollback);
  });

  it("the owner check reads the new owners on the transaction", async () => {
    await inSave(at(), async ({ tx }) => {
      const [child] = await tx.insert(familyMembers).values({ clientId: seed.clientId, firstName: "Emma", lastName: "Hendricks", role: "child", relationship: "child" }).returning();
      const [trust] = await tx.insert(entities).values({ clientId: seed.clientId, name: "Hendricks Family Trust" }).returning();
      const owners: ValidatedOwner[] = [
        { kind: "family_member", familyMemberId: child.id, percent: 0.5 },
        { kind: "entity", entityId: trust.id, percent: 0.5 },
      ];
      expect(await validateOwnersTenant(owners, seed.clientId, tx)).toBeNull();
      expect(await validateOwnersTenant(owners, seed.clientId)).toEqual({ error: "Owner not found for this client" });
    }, rollback);
  });

  it("the legacy account owners include a co-client added earlier in the transaction", async () => {
    await inSave(at(), async ({ tx }) => {
      const [laura] = await tx.insert(familyMembers).values({ clientId: seed.clientId, firstName: "Laura", lastName: "Hendricks", role: "spouse", relationship: "other" }).returning();
      expect(await synthesizeLegacyAccountOwners(seed.clientId, "joint", null, undefined, tx)).toEqual([
        { kind: "family_member", familyMemberId: seed.clientMemberId, percent: 0.5 },
        { kind: "family_member", familyMemberId: laura.id, percent: 0.5 },
      ]);
      expect(await synthesizeLegacyAccountOwners(seed.clientId, "joint", null)).toEqual([
        { kind: "family_member", familyMemberId: seed.clientMemberId, percent: 1 },
      ]);
    }, rollback);
  });

  it("the legacy liability owner is the client's own family member as the transaction has it", async () => {
    await inSave({ clientId: bare.clientId, firmId: FIRM }, async ({ tx }) => {
      const [self] = await tx.insert(familyMembers).values({ clientId: bare.clientId, firstName: "Test", lastName: "Client", role: "client", relationship: "other" }).returning();
      expect(await synthesizeLegacyLiabilityOwners(bare.clientId, null, tx)).toEqual([{ kind: "family_member", familyMemberId: self.id, percent: 1 }]);
      expect(await synthesizeLegacyLiabilityOwners(bare.clientId, null)).toEqual([]);
    }, rollback);
  });

  it("a life policy's owner check reads each kind of owner on the transaction", async () => {
    await inSave(at(), async ({ tx }) => {
      const [child] = await tx.insert(familyMembers).values({ clientId: seed.clientId, firstName: "Emma", lastName: "Hendricks", role: "child", relationship: "child" }).returning();
      const [trust] = await tx.insert(entities).values({ clientId: seed.clientId, name: "Hendricks Family Trust" }).returning();
      const [charity] = await tx.insert(externalBeneficiaries).values({ clientId: seed.clientId, name: "Denver Rescue Mission" }).returning();
      for (const ref of [{ kind: "family", id: child.id }, { kind: "entity", id: trust.id }, { kind: "external", id: charity.id }] as const) {
        expect(await assertOwnerRefInClient(seed.clientId, ref, tx), `${ref.kind}, on the transaction`).toEqual({ ok: true });
        expect((await assertOwnerRefInClient(seed.clientId, ref)).ok, `${ref.kind}, without it`).toBe(false);
      }
    }, rollback);
  });

  it("an LTC rider finds a life policy written earlier in the transaction only on it", async () => {
    await inSave(at(), async ({ tx }) => {
      const [policy] = await tx
        .insert(accounts)
        .values({ clientId: seed.clientId, scenarioId: seed.scenarioId, name: "Term Life — Mark", category: "life_insurance", insuredPerson: "client" })
        .returning();
      expect(await loadRiderLifePolicy(seed.clientId, policy.id, tx)).toEqual({ id: policy.id, category: "life_insurance", insuredPerson: "client" });
      expect(await loadRiderLifePolicy(seed.clientId, policy.id)).toBeNull();
    }, rollback);
  });

  it("audit snapshots name records written earlier in the transaction", async () => {
    await inSave(at(), async ({ tx }) => {
      const { clientId, scenarioId } = seed;
      const [model] = await tx.insert(modelPortfolios).values({ firmId: FIRM, name: "Growth 80/20" }).returning();
      const [fund] = await tx.insert(tickerPortfolios).values({ firmId: FIRM, name: "Core ETFs" }).returning();
      const [trust] = await tx.insert(entities).values({ clientId, name: "Hendricks Family Trust" }).returning();
      const [house, modelled, funded] = await tx
        .insert(accounts)
        .values([
          { clientId, scenarioId, name: "Home", category: "real_estate", subType: "primary_residence" },
          { clientId, scenarioId, name: "Schwab Brokerage", category: "taxable", subType: "brokerage", modelPortfolioId: model.id },
          { clientId, scenarioId, name: "Fidelity Brokerage", category: "taxable", subType: "brokerage", tickerPortfolioId: fund.id },
        ])
        .returning();
      const [mortgage] = await tx.insert(liabilities).values({ clientId, scenarioId, name: "Mortgage", startYear: 2020, linkedPropertyId: house.id }).returning();
      const [note] = await tx
        .insert(notesReceivable)
        .values({ clientId, scenarioId, name: "Loan to the trust", faceValue: "100000", basis: "100000", paymentType: "amortizing", startYear: 2024, termMonths: 120, linkedTrustEntityId: trust.id })
        .returning();

      expect((await toAccountSnapshot(modelled, tx)).modelPortfolio).toEqual({ id: model.id, display: "Growth 80/20" });
      expect((await toAccountSnapshot(modelled)).modelPortfolio).toEqual({ id: model.id, display: "(deleted)" });
      expect((await toAccountSnapshot(funded, tx)).tickerPortfolio).toEqual({ id: fund.id, display: "Core ETFs" });
      expect((await toAccountSnapshot(funded)).tickerPortfolio).toEqual({ id: fund.id, display: "(deleted)" });
      expect((await toLiabilitySnapshot(mortgage, tx)).linkedProperty).toEqual({ id: house.id, display: "Home" });
      expect((await toLiabilitySnapshot(mortgage)).linkedProperty).toEqual({ id: house.id, display: "(deleted)" });
      expect((await toNoteReceivableSnapshot(note, tx)).linkedTrust).toEqual({ id: trust.id, display: "Hendricks Family Trust" });
      expect((await toNoteReceivableSnapshot(note)).linkedTrust).toEqual({ id: trust.id, display: "(deleted)" });
    }, rollback);
  });

  it("the client reads as the transaction has it — a changed name, a co-client contact added", async () => {
    await inSave(at(), async ({ tx }) => {
      await tx
        .update(crmHouseholdContacts)
        .set({ firstName: "Marcus" })
        .where(and(eq(crmHouseholdContacts.householdId, seed.householdId), eq(crmHouseholdContacts.role, "primary")));
      await tx.insert(crmHouseholdContacts).values({ householdId: seed.householdId, role: "spouse", firstName: "Laura", lastName: "Hendricks" });
      const onTx = await getClientWithContacts(seed.clientId, FIRM, tx);
      expect([onTx?.firstName, onTx?.spouseFirstName]).toEqual(["Marcus", "Laura"]);
      const outside = await getClientWithContacts(seed.clientId, FIRM);
      expect([outside?.firstName, outside?.spouseFirstName]).toEqual(["Mark", null]);
    }, rollback);
  });

  it("an audit row written on the transaction rolls back with it; one written beside it survives the rollback", async () => {
    const common = { resourceType: "account", clientId: seed.clientId, firmId: FIRM, actorId: SAVE_ACTOR };
    const ids = ["on-tx-create", "on-tx-update", "on-tx-delete", "beside-tx"];
    await inSave(at(), async ({ tx }) => {
      await recordCreate({ ...common, action: "account.create", resourceId: "on-tx-create", snapshot: { name: "Schwab Brokerage" }, tx });
      await recordUpdate({
        ...common, action: "account.update", resourceId: "on-tx-update", tx,
        before: { name: "Schwab Brokerage" }, after: { name: "Schwab One" }, fieldLabels: { name: { label: "Name", format: "text" } },
      });
      await recordDelete({ ...common, action: "account.delete", resourceId: "on-tx-delete", snapshot: { name: "Schwab One" }, tx });
      await recordCreate({ ...common, action: "account.create", resourceId: "beside-tx", snapshot: { name: "Schwab Brokerage" } });
    }, rollback);
    const rows = await db
      .select({ resourceId: auditLog.resourceId })
      .from(auditLog)
      .where(and(eq(auditLog.clientId, seed.clientId), inArray(auditLog.resourceId, ids)));
    expect(rows.map((r) => r.resourceId)).toEqual(["beside-tx"]);
  });
});

d("the save test harness", () => {
  beforeAll(async () => {
    await dropSaveFirm(FIRM);
    seed = await seedSaveClient(FIRM, { coClient: true });
  });
  afterAll(() => dropSaveFirm(FIRM));

  it("seeds a client as the app creates one, with no audit rows", async () => {
    const people = await db.select({ id: familyMembers.id, role: familyMembers.role }).from(familyMembers).where(eq(familyMembers.clientId, seed.clientId));
    expect(people.map((p) => p.role).sort()).toEqual(["client", "spouse"]);
    expect([seed.clientMemberId, seed.spouseMemberId].sort()).toEqual(people.map((p) => p.id).sort());
    const client = await getClientWithContacts(seed.clientId, FIRM);
    expect([client?.firstName, client?.spouseFirstName, client?.filingStatus]).toEqual(["Mark", "Laura", "married_joint"]);
    const cash = await db.select({ name: accounts.name }).from(accounts).where(and(eq(accounts.clientId, seed.clientId), eq(accounts.isDefaultChecking, true)));
    expect(cash.map((a) => a.name)).toEqual(["Household Cash"]);
    expect(await db.select().from(auditLog).where(eq(auditLog.clientId, seed.clientId))).toEqual([]);
  });

  it("inSave commits what fn writes, or with rollback none of it; queued work runs only on flush", async () => {
    const work = vi.fn(async () => {});
    const kept = await inSave({ clientId: seed.clientId, firmId: FIRM }, async (ctx) => {
      expect(ctx).toMatchObject({ clientId: seed.clientId, firmId: FIRM, actorId: SAVE_ACTOR });
      ctx.afterCommit(work);
      const [row] = await ctx.tx.insert(externalBeneficiaries).values({ clientId: ctx.clientId, name: "Kept Charity" }).returning();
      return row.id;
    });
    expect(kept.queued).toBe(1);
    expect(work).not.toHaveBeenCalled();
    await kept.flush();
    expect(work).toHaveBeenCalledTimes(1);

    const dropped = await inSave({ clientId: seed.clientId, firmId: FIRM }, async (ctx) => {
      ctx.afterCommit(work);
      const [row] = await ctx.tx.insert(externalBeneficiaries).values({ clientId: ctx.clientId, name: "Dropped Charity" }).returning();
      return row.id;
    }, rollback);
    expect(dropped.queued).toBe(1);
    await dropped.flush();
    expect(work).toHaveBeenCalledTimes(1);

    const names = await db.select({ name: externalBeneficiaries.name }).from(externalBeneficiaries).where(inArray(externalBeneficiaries.id, [kept.result, dropped.result]));
    expect(names.map((n) => n.name)).toEqual(["Kept Charity"]);
  });

  it("changeLine builds a Create the way the review does, and inputOf turns it into the Details body", () => {
    const house = changeLine("account", { name: "Home", value: 650000 }, { fixed: { category: "real_estate", subType: "primary_residence" } });
    const houseRef: RecordRef = { ref: "line", target: "account", lineId: house.id };
    const mortgage = changeLine("liability", {
      name: "Mortgage",
      balance: 300000,
      interestRate: null,
      linkedPropertyId: houseRef,
      owners: [{ who: { ref: "person", role: "client" }, percent: 0.5 }, { who: { ref: "person", role: "spouse" }, percent: 0.5 }],
    });
    expect(mortgage).toMatchObject({ action: "create", recordId: null, target: "liability", page: "realEstateDebts", sectionId: "liab", dependsOn: [house.id] });
    expect(mortgage.fields.map((f) => [f.key, f.ticked])).toEqual([["name", true], ["balance", true], ["linkedPropertyId", true], ["owners", true]]);

    const input = inputOf(mortgage, { [`line:${house.id}`]: "acct-home", "person:client": "fm-mark", "person:spouse": "fm-laura" });
    expect(input.body).toEqual({
      name: "Mortgage",
      balance: 300000,
      linkedPropertyId: "acct-home",
      owners: [
        { kind: "family_member", familyMemberId: "fm-mark", percent: 0.5 },
        { kind: "family_member", familyMemberId: "fm-laura", percent: 0.5 },
      ],
    });
    expect([input.recordId, input.parentId]).toEqual([null, null]);
    expect(inputOf(house).body).toEqual({ category: "real_estate", subType: "primary_residence", name: "Home", value: 650000 });
    expect(() => inputOf(mortgage)).toThrow(`inputOf: no id for line:${house.id}`);
  });

  it("an Update carries no fixed values; a field's companions and a milestone resolve", () => {
    const salary = changeLine(
      "income",
      { annualAmount: 160000, growthRate: 0.04, end: { yearRef: "client_retirement" } },
      { recordId: "inc-1", fixed: { type: "salary" }, with: { growthRate: { growthSource: "custom" } } },
    );
    expect(salary.action).toBe("update");
    expect(salary.fixed).toBeUndefined();
    expect(salary.fields.every((f) => f.ticked && f.onRecord === null)).toBe(true);
    expect(inputOf(salary)).toMatchObject({
      recordId: "inc-1",
      parentId: null,
      body: { annualAmount: 160000, growthSource: "custom", growthRate: 0.04, endYear: REF_YEAR, endYearRef: "client_retirement" },
    });

    const tiers = changeLine(
      "account_beneficiary_designation",
      { beneficiaries: [{ tier: "contingent", who: { ref: "person", role: "spouse" }, percentage: 100 }] },
      { parent: { ref: "record", target: "account", id: "acct-ira" } },
    );
    expect(inputOf(tiers)).toMatchObject({
      parentId: "acct-ira",
      body: { beneficiaries: [{ tier: "contingent", percentage: 100, householdRole: "spouse", sortOrder: 0 }] },
    });
  });
});
