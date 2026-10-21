// src/lib/fact-finder/save/__tests__/writers-wills.test.ts
//
// Live dev database: the wills writers inside one save transaction (Plan 4,
// Task 13). A will, its provision and its remaining estate made in one save,
// each seeing the records written before it; a provision update that leaves
// the will's other provisions — and their ids — alone; a new provision after
// the record's; the remaining estate's contingent rows kept; a rollback that
// leaves nothing. Bodies come from payloadFor over change lines built like the
// review's. Everything lives under a firm id no other suite uses.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_ff_save", orgId: "firm_test_ff_save_wills", orgRole: "org:admin" }),
}));

import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accounts, auditLog, externalBeneficiaries, familyMembers, liabilities, willBequestRecipients, willBequests, willResiduaryRecipients, wills } from "@/db/schema";
import { createWillForClient, replaceWillResiduaryForClient, updateWillForClient } from "@/lib/clients/wills-writes";
import type { PlacedValue, RecordRef, TargetKind } from "../../change-set";
import { SaveLineError } from "../types";
import { WILL_WRITERS } from "../writers/wills";
import { SAVE_ACTOR, changeLine, dropSaveFirm, inSave, inputOf, seedSaveClient, type SaveSeed } from "./harness";

const FIRM = "firm_test_ff_save_wills";
const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const record = (target: TargetKind, id: string): RecordRef => ({ ref: "record", target, id });
const line = (target: TargetKind, lineId: string): RecordRef => ({ ref: "line", target, lineId });
const CO_CLIENT: RecordRef = { ref: "person", role: "spouse" };
const rollback = { rollback: true };

/** A provision line as the Will Provisions map builds one: name and place in `fixed`, the will its parent, an asset's mode with its kind. */
function provisionLine(parent: RecordRef, fields: Record<string, PlacedValue>, opts: { name?: string; sortOrder?: number; recordId?: string } = {}) {
  return changeLine("will_bequest", fields, {
    parent,
    recordId: opts.recordId,
    fixed: { name: opts.name ?? "Provision", sortOrder: opts.sortOrder ?? 0 },
    with: fields.kind === "asset" ? { kind: { assetMode: "specific" } } : undefined,
  });
}

const bequestsOf = (willId: string) => db.select().from(willBequests).where(eq(willBequests.willId, willId)).orderBy(asc(willBequests.sortOrder));
const recipientsOf = (bequestId: string) =>
  db.select().from(willBequestRecipients).where(eq(willBequestRecipients.bequestId, bequestId)).orderBy(asc(willBequestRecipients.sortOrder));
const residuaryOf = (willId: string) =>
  db.select().from(willResiduaryRecipients).where(eq(willResiduaryRecipients.willId, willId)).orderBy(asc(willResiduaryRecipients.sortOrder));
const auditsOf = (clientId: string) => db.select().from(auditLog).where(eq(auditLog.clientId, clientId));

d("wills writers (Plan 4, Task 13)", () => {
  beforeAll(() => dropSaveFirm(FIRM));
  afterAll(() => dropSaveFirm(FIRM));

  /** A will, its provision of a new account to a new charity, and its remaining estate — all in one save. */
  async function saveNewWill(seed: SaveSeed, opts: { rollback?: boolean } = {}) {
    return inSave({ clientId: seed.clientId, firmId: FIRM }, async (ctx) => {
      const [account] = await ctx.tx
        .insert(accounts)
        .values({ clientId: seed.clientId, scenarioId: seed.scenarioId, name: "Schwab Brokerage", category: "taxable", subType: "brokerage" })
        .returning();
      const [charity] = await ctx.tx.insert(externalBeneficiaries).values({ clientId: seed.clientId, name: "Denver Rescue Mission" }).returning();
      const will = changeLine("will", { grantor: "client" }, { id: "docs-client/will", label: "Mark's will" });
      const willId = await WILL_WRITERS.will.create(ctx, inputOf(will));
      const ids = { "line:docs-client/will": willId, "line:acct-1/account": account.id, "line:ext-1/external_beneficiary": charity.id };
      const provision = provisionLine(
        line("will", will.id),
        {
          kind: "asset",
          accountId: line("account", "acct-1/account"),
          percentage: 100,
          recipients: [{ who: line("external_beneficiary", "ext-1/external_beneficiary"), percentage: 100 }],
          condition: "always",
        },
        { name: "Schwab Brokerage" },
      );
      const bequestId = await WILL_WRITERS.will_bequest.create(ctx, inputOf(provision, ids));
      const rest = changeLine("will_residuary_recipient", { recipients: [{ who: CO_CLIENT, percentage: 100 }] }, { parent: line("will", will.id) });
      const restId = await WILL_WRITERS.will_residuary_recipient.create(ctx, inputOf(rest, ids));
      return { willId, bequestId, restId, accountId: account.id, charityId: charity.id };
    }, opts);
  }

  it("a will, then a provision giving an account and a charity made earlier in the save, then its remaining estate — with their audit rows", async () => {
    const seed = await seedSaveClient(FIRM, { coClient: true });
    const { result, queued } = await saveNewWill(seed);
    const { willId, bequestId, restId, accountId, charityId } = result;

    expect(restId).toBe(willId);
    const [will] = await db.select().from(wills).where(eq(wills.clientId, seed.clientId));
    expect(will).toMatchObject({ id: willId, grantor: "client", executor: null, executionDate: null });
    const [bequest] = await bequestsOf(willId);
    expect(bequest).toMatchObject({
      id: bequestId, name: "Schwab Brokerage", kind: "asset", assetMode: "specific", accountId, entityId: null, liabilityId: null,
      percentage: "100.00", condition: "always", sortOrder: 0,
    });
    expect(await recipientsOf(bequestId)).toMatchObject([{ recipientKind: "external_beneficiary", recipientId: charityId, percentage: "100.00", sortOrder: 0 }]);
    expect(await residuaryOf(willId)).toMatchObject([{ recipientKind: "spouse", recipientId: null, tier: "primary", percentage: "100.00", sortOrder: 0 }]);

    const audits = await auditsOf(seed.clientId);
    expect(audits.map((a) => a.action).sort()).toEqual(["will.create", "will.update", "will.update"]);
    expect(audits.every((a) => a.resourceId === willId && a.actorId === SAVE_ACTOR && a.firmId === FIRM)).toBe(true);
    expect(audits.find((a) => a.action === "will.create")?.metadata).toMatchObject({ grantor: "client", bequestCount: 0 });
    expect(audits.filter((a) => a.action === "will.update").map((a) => (a.metadata as { bequestCount: number }).bequestCount)).toEqual([1, 1]);
    // Nothing waits for the commit.
    expect(queued).toBe(0);
  });

  it("the same save rolled back leaves no will, provision, remaining estate or audit row", async () => {
    const seed = await seedSaveClient(FIRM, { coClient: true });
    const { result } = await saveNewWill(seed, rollback);

    expect(await db.select().from(wills).where(eq(wills.clientId, seed.clientId))).toEqual([]);
    expect(await db.select().from(willBequests).where(eq(willBequests.id, result.bequestId))).toEqual([]);
    expect(await db.select().from(willResiduaryRecipients).where(eq(willResiduaryRecipients.willId, result.willId))).toEqual([]);
    expect(await auditsOf(seed.clientId)).toEqual([]);
  });

  it("on a will on record: an update changes one provision in place, a new one lands after the record's, the remaining estate keeps its contingent rows", async () => {
    const seed = await seedSaveClient(FIRM, { coClient: true });
    const { clientId, scenarioId } = seed;
    const [schwab, ira, roth] = await db
      .insert(accounts)
      .values([
        { clientId, scenarioId, name: "Schwab Brokerage", category: "taxable", subType: "brokerage" },
        { clientId, scenarioId, name: "Fidelity IRA", category: "taxable", subType: "brokerage" },
        { clientId, scenarioId, name: "Vanguard Roth", category: "taxable", subType: "brokerage" },
      ])
      .returning();
    const [emma] = await db.insert(familyMembers).values({ clientId, firstName: "Emma", lastName: "Hendricks", role: "child", relationship: "child" }).returning();
    const [will] = await db.insert(wills).values({ clientId, grantor: "client", executor: "Jane Smith", executionDate: "2019-05-01" }).returning();
    const [kept, retargeted, reshared] = await db
      .insert(willBequests)
      .values([
        { willId: will.id, name: "Schwab Brokerage", kind: "asset", assetMode: "specific", accountId: schwab.id, percentage: "50", condition: "always", sortOrder: 0 },
        { willId: will.id, name: "Fidelity IRA", kind: "asset", assetMode: "specific", accountId: ira.id, percentage: "100", condition: "if_spouse_predeceased", sortOrder: 1 },
        { willId: will.id, name: "Vanguard Roth", kind: "asset", assetMode: "specific", accountId: roth.id, percentage: "100", condition: "always", sortOrder: 2 },
      ])
      .returning();
    const before = await db
      .insert(willBequestRecipients)
      .values([kept, retargeted, reshared].map((b) => ({ bequestId: b.id, recipientKind: "family_member" as const, recipientId: emma.id, percentage: "100", sortOrder: 0 })))
      .returning();
    const [primary, contingent] = await db
      .insert(willResiduaryRecipients)
      .values([
        { willId: will.id, recipientKind: "spouse", recipientId: null, tier: "primary", percentage: "100", sortOrder: 0 },
        { willId: will.id, recipientKind: "family_member", recipientId: emma.id, tier: "contingent", percentage: "100", sortOrder: 1 },
      ])
      .returning();

    const onRecord = record("will", will.id);
    await inSave({ clientId, firmId: FIRM }, async (ctx) => {
      // Only "% of it" changes: the recipients on record stay as they are.
      await WILL_WRITERS.will_bequest.update(ctx, inputOf(provisionLine(onRecord, { percentage: 60 }, { recordId: retargeted.id })));
      await WILL_WRITERS.will_bequest.update(
        ctx,
        inputOf(provisionLine(onRecord, { recipients: [{ who: record("family_member", emma.id), percentage: 50 }, { who: CO_CLIENT, percentage: 50 }] }, { recordId: reshared.id })),
      );
      // The import's first provision (its fixed sortOrder 0) goes after the will's three.
      const [cash] = await ctx.tx.insert(accounts).values({ clientId, scenarioId, name: "Chase Savings", category: "cash", subType: "savings" }).returning();
      await WILL_WRITERS.will_bequest.create(
        ctx,
        inputOf(
          provisionLine(onRecord, { kind: "asset", accountId: record("account", cash.id), percentage: 100, recipients: [{ who: CO_CLIENT, percentage: 100 }], condition: "always" }, { name: "Chase Savings", sortOrder: 0 }),
        ),
      );
      await WILL_WRITERS.will_residuary_recipient.update(
        ctx,
        inputOf(changeLine("will_residuary_recipient", { recipients: [{ who: record("family_member", emma.id), percentage: 100 }] }, { recordId: will.id, parent: onRecord })),
      );
    });

    const after = await bequestsOf(will.id);
    expect(after.map((b) => [b.id, b.name, b.sortOrder])).toEqual([
      [kept.id, "Schwab Brokerage", 0],
      [retargeted.id, "Fidelity IRA", 1],
      [reshared.id, "Vanguard Roth", 2],
      [after[3].id, "Chase Savings", 3],
    ]);
    // Untouched: the provision the import didn't list, and the parts of each it didn't change.
    expect(after[0]).toMatchObject({ percentage: "50.00", condition: "always", accountId: schwab.id });
    expect(after[1]).toMatchObject({ percentage: "60.00", condition: "if_spouse_predeceased", accountId: ira.id, assetMode: "specific" });
    expect(after[2]).toMatchObject({ percentage: "100.00", condition: "always", accountId: roth.id });
    expect((await recipientsOf(kept.id)).map((r) => r.id)).toEqual([before[0].id]);
    expect((await recipientsOf(retargeted.id)).map((r) => r.id)).toEqual([before[1].id]);
    // Replaced: the recipients of the provision whose recipients changed.
    expect(await recipientsOf(reshared.id)).toMatchObject([
      { recipientKind: "family_member", recipientId: emma.id, percentage: "50.00", sortOrder: 0 },
      { recipientKind: "spouse", recipientId: null, percentage: "50.00", sortOrder: 1 },
    ]);
    // The remaining estate: primary replaced, contingent kept with its id.
    const rest = await residuaryOf(will.id);
    expect(rest.find((r) => r.tier === "contingent")).toEqual(contingent);
    expect(rest.filter((r) => r.tier === "primary")).toMatchObject([{ recipientKind: "family_member", recipientId: emma.id, percentage: "100.00" }]);
    expect(rest.some((r) => r.id === primary.id)).toBe(false);
    // Neither the import nor the Details routes write these.
    const [stillWill] = await db.select().from(wills).where(eq(wills.id, will.id));
    expect(stillWill).toMatchObject({ executor: "Jane Smith", executionDate: "2019-05-01", grantor: "client" });

    const audits = await auditsOf(clientId);
    expect(audits.map((a) => a.action)).toEqual(["will.update", "will.update", "will.update", "will.update"]);
    expect(audits.map((a) => (a.metadata as { bequestCount: number }).bequestCount).sort()).toEqual([3, 3, 4, 4]);
  });

  describe("Other Heirs on record", () => {
    /** A will on record whose provision and remaining estate both leave a share to Other Heirs. */
    async function willWithOtherHeirs() {
      const seed = await seedSaveClient(FIRM, { coClient: true });
      const { clientId, scenarioId } = seed;
      const [schwab] = await db.insert(accounts).values({ clientId, scenarioId, name: "Schwab Brokerage", category: "taxable", subType: "brokerage" }).returning();
      const [emma] = await db.insert(familyMembers).values({ clientId, firstName: "Emma", lastName: "Hendricks", role: "child", relationship: "child" }).returning();
      const [will] = await db.insert(wills).values({ clientId, grantor: "client" }).returning();
      const [bequest] = await db
        .insert(willBequests)
        .values({ willId: will.id, name: "Schwab Brokerage", kind: "asset", assetMode: "specific", accountId: schwab.id, percentage: "100", condition: "always", sortOrder: 0 })
        .returning();
      await db.insert(willBequestRecipients).values({ bequestId: bequest.id, recipientKind: "other_heirs", recipientId: null, percentage: "100", sortOrder: 0 });
      await db.insert(willResiduaryRecipients).values({ willId: will.id, recipientKind: "other_heirs", recipientId: null, tier: "primary", percentage: "100", sortOrder: 0 });
      return { seed, will: will.id, bequest: bequest.id, emma: emma.id };
    }

    it("refuses to replace a remaining estate that names Other Heirs", async () => {
      const { seed, will, emma } = await willWithOtherHeirs();
      const onRecord = record("will", will);
      await expect(
        inSave({ clientId: seed.clientId, firmId: FIRM }, (ctx) =>
          WILL_WRITERS.will_residuary_recipient.update(
            ctx,
            inputOf(changeLine("will_residuary_recipient", { recipients: [{ who: record("family_member", emma), percentage: 100 }] }, { recordId: will, parent: onRecord })),
          ),
        ),
      ).rejects.toThrow("This will leaves a share to Other Heirs, which can only be changed in the app.");
      expect(await residuaryOf(will)).toMatchObject([{ recipientKind: "other_heirs", recipientId: null, tier: "primary" }]);
    });

    it("refuses to change a provision that leaves a share to Other Heirs", async () => {
      const { seed, will, bequest, emma } = await willWithOtherHeirs();
      await expect(
        inSave({ clientId: seed.clientId, firmId: FIRM }, (ctx) =>
          WILL_WRITERS.will_bequest.update(
            ctx,
            inputOf(provisionLine(record("will", will), { recipients: [{ who: record("family_member", emma), percentage: 100 }] }, { recordId: bequest })),
          ),
        ),
      ).rejects.toThrow("This will leaves a share to Other Heirs, which can only be changed in the app.");
      expect(await recipientsOf(bequest)).toMatchObject([{ recipientKind: "other_heirs", recipientId: null }]);
    });

    it("still changes a provision's share when it leaves its Other Heirs recipients alone", async () => {
      const { seed, will, bequest } = await willWithOtherHeirs();
      await inSave({ clientId: seed.clientId, firmId: FIRM }, (ctx) =>
        WILL_WRITERS.will_bequest.update(ctx, inputOf(provisionLine(record("will", will), { percentage: 60 }, { recordId: bequest }))),
      );
      const [after] = await bequestsOf(will);
      expect(after.percentage).toBe("60.00");
      expect(await recipientsOf(bequest)).toMatchObject([{ recipientKind: "other_heirs", recipientId: null }]);
    });
  });

  it("provisions added in one save keep the import's order: a new will's from 0, a will on record's after its own three", async () => {
    const seed = await seedSaveClient(FIRM, { coClient: true });
    const { clientId, scenarioId } = seed;
    const made = await db
      .insert(accounts)
      .values(["Schwab Brokerage", "Chase Savings", "Fidelity IRA", "Vanguard Roth"].map((name) => ({ clientId, scenarioId, name, category: "taxable" as const, subType: "brokerage" as const })))
      .returning();
    const [laurasWill] = await db.insert(wills).values({ clientId, grantor: "spouse" }).returning();
    await db.insert(willBequests).values(
      [0, 1, 2].map((sortOrder) => ({ willId: laurasWill.id, name: `On record ${sortOrder}`, kind: "asset" as const, assetMode: "all_assets" as const, percentage: "100", condition: "always" as const, sortOrder })),
    );
    const gift = (will: RecordRef, account: (typeof made)[number], sortOrder: number) =>
      provisionLine(
        will,
        { kind: "asset", accountId: record("account", account.id), percentage: 100, recipients: [{ who: CO_CLIENT, percentage: 100 }], condition: "always" },
        { name: account.name, sortOrder },
      );

    const { result: marksWill } = await inSave({ clientId, firmId: FIRM }, async (ctx) => {
      const will = changeLine("will", { grantor: "client" }, { id: "docs-client/will" });
      const willId = await WILL_WRITERS.will.create(ctx, inputOf(will));
      const ids = { "line:docs-client/will": willId };
      await WILL_WRITERS.will_bequest.create(ctx, inputOf(gift(line("will", will.id), made[0], 0), ids));
      await WILL_WRITERS.will_bequest.create(ctx, inputOf(gift(line("will", will.id), made[1], 1), ids));
      await WILL_WRITERS.will_bequest.create(ctx, inputOf(gift(record("will", laurasWill.id), made[2], 0)));
      await WILL_WRITERS.will_bequest.create(ctx, inputOf(gift(record("will", laurasWill.id), made[3], 1)));
      return willId;
    });

    const order = async (willId: string) => (await bequestsOf(willId)).map((b) => [b.name, b.sortOrder]);
    expect({ new: await order(marksWill), onRecord: await order(laurasWill.id) }).toEqual({
      new: [["Schwab Brokerage", 0], ["Chase Savings", 1]],
      onRecord: [["On record 0", 0], ["On record 1", 1], ["On record 2", 2], ["Fidelity IRA", 3], ["Vanguard Roth", 4]],
    });
  });

  it("a provision written earlier in the save is changed in place by a later line", async () => {
    const seed = await seedSaveClient(FIRM, { coClient: true });
    const { clientId, scenarioId } = seed;
    const [schwab] = await db.insert(accounts).values({ clientId, scenarioId, name: "Schwab Brokerage", category: "taxable", subType: "brokerage" }).returning();
    const { result } = await inSave(
      { clientId, firmId: FIRM },
      async (ctx) => {
        const [will] = await ctx.tx.insert(wills).values({ clientId, grantor: "client" }).returning();
        const onWill = record("will", will.id);
        const bequestId = await WILL_WRITERS.will_bequest.create(
          ctx,
          inputOf(provisionLine(onWill, { kind: "asset", accountId: record("account", schwab.id), percentage: 100, recipients: [{ who: CO_CLIENT, percentage: 100 }], condition: "always" }, { name: "Schwab Brokerage" })),
        );
        await WILL_WRITERS.will_bequest.update(ctx, inputOf(provisionLine(onWill, { percentage: 60 }, { recordId: bequestId })));
        const [bequest] = await ctx.tx.select().from(willBequests).where(eq(willBequests.id, bequestId));
        const recipients = await ctx.tx.select().from(willBequestRecipients).where(eq(willBequestRecipients.bequestId, bequestId));
        return { bequest, recipients };
      },
      rollback,
    );
    expect(result.bequest).toMatchObject({ percentage: "60.00", accountId: schwab.id, condition: "always" });
    expect(result.recipients).toMatchObject([{ recipientKind: "spouse", percentage: "100.00" }]);
  });

  it("a provision added to a will on record, rolled back, leaves the will as it was — its updated-at too — and no audit row", async () => {
    const seed = await seedSaveClient(FIRM, { coClient: true });
    const { clientId, scenarioId } = seed;
    const [schwab] = await db.insert(accounts).values({ clientId, scenarioId, name: "Schwab Brokerage", category: "taxable", subType: "brokerage" }).returning();
    const [will] = await db.insert(wills).values({ clientId, grantor: "client" }).returning();
    const add = provisionLine(record("will", will.id), { kind: "asset", accountId: record("account", schwab.id), percentage: 100, recipients: [{ who: CO_CLIENT, percentage: 100 }], condition: "always" });

    await inSave({ clientId, firmId: FIRM }, (ctx) => WILL_WRITERS.will_bequest.create(ctx, inputOf(add)), rollback);

    const [after] = await db.select().from(wills).where(eq(wills.id, will.id));
    expect(after.updatedAt).toEqual(will.updatedAt);
    expect(await bequestsOf(will.id)).toEqual([]);
    expect(await auditsOf(clientId)).toEqual([]);
  });

  it("a provision or a remaining estate with no will to go on refuses in its own words", async () => {
    const seed = await seedSaveClient(FIRM, { coClient: true });
    const orphan = (target: "will_bequest" | "will_residuary_recipient") => {
      const built = target === "will_bequest"
        ? provisionLine(record("will", seed.clientId), { kind: "asset", accountId: null, percentage: 100, recipients: [{ who: CO_CLIENT, percentage: 100 }], condition: "always" })
        : changeLine("will_residuary_recipient", { recipients: [{ who: CO_CLIENT, percentage: 100 }] }, { parent: record("will", seed.clientId) });
      return inputOf(built, {}, { parentId: null });
    };
    const refused = await inSave(
      { clientId: seed.clientId, firmId: FIRM },
      async (ctx) => [
        await WILL_WRITERS.will_bequest.create(ctx, orphan("will_bequest")).catch((err: unknown) => err),
        await WILL_WRITERS.will_residuary_recipient.create(ctx, orphan("will_residuary_recipient")).catch((err: unknown) => err),
      ],
      rollback,
    );
    expect(refused.result.map((err) => [(err as Error).name, (err as Error).message])).toEqual([
      ["SaveLineError", "This provision names no will."],
      ["SaveLineError", "This remaining estate names no will."],
    ]);
  });

  it("refuses a provision on a will that isn't this client's, or a provision that isn't on its will", async () => {
    const seed = await seedSaveClient(FIRM, { coClient: true });
    const other = await seedSaveClient(FIRM);
    await inSave({ clientId: seed.clientId, firmId: FIRM }, async (ctx) => {
      const [theirs] = await ctx.tx.insert(wills).values({ clientId: other.clientId, grantor: "client" }).returning();
      const [mine, laurasWill] = await ctx.tx
        .insert(wills)
        .values([{ clientId: seed.clientId, grantor: "client" }, { clientId: seed.clientId, grantor: "spouse" }])
        .returning();
      const [laurasProvision] = await ctx.tx
        .insert(willBequests)
        .values({ willId: laurasWill.id, name: "All of it", kind: "asset", assetMode: "all_assets", percentage: "100", condition: "always", sortOrder: 0 })
        .returning();
      const gift = { kind: "asset", accountId: null, percentage: 100, recipients: [{ who: CO_CLIENT, percentage: 100 }], condition: "always" };

      await expect(WILL_WRITERS.will_bequest.create(ctx, inputOf(provisionLine(record("will", theirs.id), gift)))).rejects.toThrow(new SaveLineError("Will not found"));
      await expect(
        WILL_WRITERS.will_bequest.update(ctx, inputOf(provisionLine(record("will", mine.id), { percentage: 50 }, { recordId: laurasProvision.id }))),
      ).rejects.toThrow(new SaveLineError("Will provision not found"));
      await expect(
        WILL_WRITERS.will_residuary_recipient.update(ctx, inputOf(changeLine("will_residuary_recipient", { recipients: [{ who: CO_CLIENT, percentage: 100 }] }, { recordId: theirs.id, parent: record("will", theirs.id) }))),
      ).rejects.toThrow(new SaveLineError("Will not found"));
    }, rollback);
  });

  it("refuses a debt tied to a property, in plain words", async () => {
    const seed = await seedSaveClient(FIRM, { coClient: true });
    await inSave({ clientId: seed.clientId, firmId: FIRM }, async (ctx) => {
      const { clientId, scenarioId } = seed;
      const [house] = await ctx.tx.insert(accounts).values({ clientId, scenarioId, name: "Home", category: "real_estate", subType: "primary_residence" }).returning();
      const [mortgage] = await ctx.tx.insert(liabilities).values({ clientId, scenarioId, name: "Mortgage", startYear: 2020, linkedPropertyId: house.id }).returning();
      const [emma] = await ctx.tx.insert(familyMembers).values({ clientId, firstName: "Emma", lastName: "Hendricks", role: "child", relationship: "child" }).returning();
      const [will] = await ctx.tx.insert(wills).values({ clientId, grantor: "client" }).returning();
      const debt = provisionLine(
        record("will", will.id),
        { kind: "liability", liabilityId: record("liability", mortgage.id), recipients: [{ who: record("family_member", emma.id), percentage: 100 }], condition: "always" },
        { name: "Mortgage" },
      );
      await expect(WILL_WRITERS.will_bequest.create(ctx, inputOf(debt))).rejects.toThrow(
        new SaveLineError("A debt tied to a property goes with the property — a will can't leave it on its own."),
      );
    }, rollback);
  });

  it("refuses a second provision for one debt, in plain words (the unique index the routes map)", async () => {
    const seed = await seedSaveClient(FIRM, { coClient: true });
    await inSave({ clientId: seed.clientId, firmId: FIRM }, async (ctx) => {
      const { clientId, scenarioId } = seed;
      const [loan] = await ctx.tx.insert(liabilities).values({ clientId, scenarioId, name: "Car loan", startYear: 2022 }).returning();
      const [emma] = await ctx.tx.insert(familyMembers).values({ clientId, firstName: "Emma", lastName: "Hendricks", role: "child", relationship: "child" }).returning();
      const [will] = await ctx.tx.insert(wills).values({ clientId, grantor: "client" }).returning();
      await ctx.tx.insert(willBequests).values({ willId: will.id, name: "Car loan", kind: "liability", liabilityId: loan.id, percentage: "100", condition: "always", sortOrder: 0 });
      const debt = provisionLine(
        record("will", will.id),
        { kind: "liability", liabilityId: record("liability", loan.id), recipients: [{ who: record("family_member", emma.id), percentage: 100 }], condition: "always" },
        { name: "Car loan" },
      );
      // The violation aborts the transaction: it is this one's last statement.
      await expect(WILL_WRITERS.will_bequest.create(ctx, inputOf(debt))).rejects.toThrow(
        new SaveLineError("This will already has a provision for this debt — one per debt."),
      );
    }, rollback);
  });

  it("the remaining estate is written only as a primary tier that names someone", async () => {
    const seed = await seedSaveClient(FIRM, { coClient: true });
    await inSave({ clientId: seed.clientId, firmId: FIRM }, async (ctx) => {
      const [will] = await ctx.tx.insert(wills).values({ clientId: seed.clientId, grantor: "client" }).returning();
      const args = { tx: ctx.tx, afterCommit: ctx.afterCommit, clientId: seed.clientId, firmId: FIRM, actorId: SAVE_ACTOR, willId: will.id };
      expect(await replaceWillResiduaryForClient({ ...args, input: { residuaryRecipients: [] } })).toMatchObject({ ok: false, status: 400, error: "Name who receives the remaining estate." });
      expect(
        await replaceWillResiduaryForClient({ ...args, input: { residuaryRecipients: [{ recipientKind: "spouse", recipientId: null, tier: "contingent", percentage: 100, sortOrder: 0 }] } }),
      ).toMatchObject({ ok: false, status: 400, error: "Only the primary tier of the remaining estate is replaced here." });
      expect(await residuaryOf(will.id)).toEqual([]);
    }, rollback);
  });

  it("a will on the plan is never updated by the import", async () => {
    const seed = await seedSaveClient(FIRM);
    await inSave({ clientId: seed.clientId, firmId: FIRM }, async (ctx) => {
      await expect(WILL_WRITERS.will.update(ctx, inputOf(changeLine("will", { grantor: "client" }, { recordId: seed.clientId })))).rejects.toThrow(SaveLineError);
    }, rollback);
  });

  it("the Details routes' will writes run on the caller's transaction: create, then a whole-replace update naming an account made in it", async () => {
    const seed = await seedSaveClient(FIRM, { coClient: true });
    await inSave({ clientId: seed.clientId, firmId: FIRM }, async (ctx) => {
      const opts = { tx: ctx.tx, afterCommit: ctx.afterCommit, clientId: seed.clientId, firmId: FIRM, actorId: SAVE_ACTOR };
      const created = await createWillForClient({ ...opts, input: { grantor: "client" } });
      expect(created).toMatchObject({ ok: true, data: { grantor: "client", bequests: [] } });
      if (!created.ok) return;
      const [account] = await ctx.tx
        .insert(accounts)
        .values({ clientId: seed.clientId, scenarioId: seed.scenarioId, name: "Schwab Brokerage", category: "taxable", subType: "brokerage" })
        .returning();
      const input = {
        bequests: [
          { kind: "asset", name: "Schwab Brokerage", assetMode: "specific", accountId: account.id, percentage: 100, condition: "always", sortOrder: 0, recipients: [{ recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 }] },
        ],
      };
      expect(await updateWillForClient({ ...opts, willId: created.resourceId, input })).toMatchObject({ ok: true, resourceId: created.resourceId });
      expect(await ctx.tx.select().from(willBequests).where(inArray(willBequests.willId, [created.resourceId]))).toMatchObject([{ accountId: account.id }]);
      // Outside the transaction neither the will nor the account exists yet.
      expect(await updateWillForClient({ clientId: seed.clientId, firmId: FIRM, actorId: SAVE_ACTOR, willId: created.resourceId, input })).toMatchObject({ ok: false, status: 404, error: "Will not found" });
    }, rollback);
    // Neither write's audit row (will.create, will.update) outlives the rollback.
    expect(await auditsOf(seed.clientId)).toEqual([]);
  });
});
