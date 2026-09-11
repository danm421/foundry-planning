// src/lib/scenario/__tests__/promote-gift.test.ts
//
// Forking gift writes into the scenario made PROMOTION load-bearing: a gift
// saved while a scenario is active is now a `scenario_change` overlay row, and
// the only thing that turns it back into a real `gifts` row is promote.
//
// The trap this pins: a `gift` change's payload is an EstateFlowGift DRAFT, not
// a `gifts` row. Its recipient is a `{kind, id}` ref, its Crummey flag is
// `crummey`, and an asset gift's manual valuation is `amountOverride` — none of
// which are column names. `coerceForTable` copies only exact column-name
// matches, so all three were dropped SILENTLY and the promoted row arrived with
// three NULL recipient FK columns, `use_crummey_powers` false and `amount` NULL.
//
// Real DB (dev branch) rather than a fake tx: the three recipient columns carry
// real FKs and `amount`/`percent`/`valuation_discount` are `numeric`, which
// comes back as a STRING. A mocked tx cannot show either.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  entities,
  giftSeries,
  gifts,
  liabilities,
  scenarios,
  scenarioChanges,
} from "@/db/schema";
import type { ClientData } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";
import { applyEntityAdd, applyEntityRemove } from "../changes-writer";
import { scenarioChangesToBaseWrites } from "../scenario-changes-to-base-writes";
import { executeBaseWritePlan } from "../execute-base-write-plan";
import { copyGiftSeriesToBase } from "../promote-direct-tables";
import { PROMOTE_TABLE_REGISTRY } from "../promote-table-registry";

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
/** A second dev client, used only to prove the id-preserving update cannot
 *  reach across tenants. Belongs to a different firm (`firm_test_entities`). */
const OTHER_CLIENT_ID = "55d2752a-94cf-44f7-9d4d-311cfd645ceb";

const HAS_DB = !!process.env.DATABASE_URL;

/** The classifier reads the base tree only to ask the engine for cascade drops;
 *  a gift add produces none, so a minimal tree is the honest input here (same
 *  fixture shape scenario-changes-to-base-writes.test.ts uses). */
const minimalClientData = (): ClientData =>
  ({
    client: { id: COOPER_CLIENT_ID } as unknown as ClientData["client"],
    planSettings: { id: "ps1", planStartYear: 2026 } as unknown as ClientData["planSettings"],
    accounts: [],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    gifts: [],
    giftEvents: [],
  }) as unknown as ClientData;

describe("PROMOTE_TABLE_REGISTRY — the gift-only opt-ins", () => {
  // Inertness, asserted rather than assumed: the executor now branches on both
  // of these, so every other kind's behaviour is unchanged only for as long as
  // no other entry grows one silently.
  it("registers a translate hook for gift and for no other kind", () => {
    const withTranslate = Object.entries(PROMOTE_TABLE_REGISTRY)
      .filter(([, entry]) => entry?.translate !== undefined)
      .map(([kind]) => kind);
    expect(withTranslate).toEqual(["gift"]);
  });

  it("still refuses to translate a recurring series into a `gifts` row", () => {
    // A TRIPWIRE, and deliberately unreachable: `scenarioChangesToBaseWrites`
    // now partitions series-shaped `gift` changes out of `plan.inserts` into
    // `plan.giftSeries`, so nothing reaches this hook with one. It stays
    // because the failure it prevents is silent — `gift_series` is not a
    // TargetKind, and a series forced into `gifts` dies on the NOT NULL `year`
    // column with an opaque DB error, or worse, lands half-formed.
    const translate = PROMOTE_TABLE_REGISTRY.gift!.translate!;
    expect(() =>
      translate({
        id: "gs-direct",
        kind: "series",
        startYear: 2027,
        endYear: 2031,
        annualAmount: 19_000,
        amountMode: "fixed",
        inflationAdjust: false,
        grantor: "client",
        recipient: { kind: "entity", id: "trust-1" },
        crummey: true,
      }),
    ).toThrow(/gs-direct.*series/is);
  });

  it("opts gift, and only gift, into preserving the change's own id", () => {
    // Every other kind's add is genuinely new and its targetId is a synthetic
    // uuid, so they must keep the DB-generated id.
    const withPreserveId = Object.entries(PROMOTE_TABLE_REGISTRY)
      .filter(([, entry]) => entry?.preserveId === true)
      .map(([kind]) => kind);
    expect(withPreserveId).toEqual(["gift"]);
  });
});

describe.skipIf(!HAS_DB)("promote — a scenario `gift` add becomes a base gifts row", () => {
  let scenarioId: string;
  let baseScenarioId: string;
  let trustId: string;
  let accountId: string;
  /** Names of entities a PROMOTE minted (a scenario-created trust gets a fresh
   *  DB uuid, so there is no id to collect up front). Nothing else in this file
   *  creates them, and the existing trust-cascade teardown cannot reach them. */
  let promotedEntityNames: string[];

  beforeEach(async () => {
    promotedEntityNames = [];
    const [base] = await db
      .select({ id: scenarios.id })
      .from(scenarios)
      .where(
        and(eq(scenarios.clientId, COOPER_CLIENT_ID), eq(scenarios.isBaseCase, true)),
      );
    baseScenarioId = base.id;

    const [scenario] = await db
      .insert(scenarios)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `promote-gift-test-${randomUUID().slice(0, 8)}`,
        isBaseCase: false,
      })
      .returning();
    scenarioId = scenario.id;

    // A real recipient row: `gifts.recipient_entity_id` carries an FK, so the
    // promoted insert only succeeds against an entity that exists.
    const [trust] = await db
      .insert(entities)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `promote-gift-test-trust-${randomUUID().slice(0, 8)}`,
        entityType: "trust",
      })
      .returning();
    trustId = trust.id;

    // Source account for the asset arm. It has to hang off the BASE scenario:
    // a DB trigger (assert_scenario_is_base_case) rejects an `accounts` row
    // written against any non-base scenario, so it is cleaned up explicitly
    // below rather than riding the throwaway scenario's cascade.
    const [acct] = await db
      .insert(accounts)
      .values({
        clientId: COOPER_CLIENT_ID,
        scenarioId: baseScenarioId,
        name: "promote-gift-test-brokerage",
        category: "taxable",
        value: "1000000",
      })
      .returning();
    accountId = acct.id;
  });

  afterEach(async () => {
    // A promote-minted entity goes FIRST, and by name: its id is generated
    // inside the promote, the name is per-run unique (so a concurrent run of
    // this file is never touched), and this runs even when the test threw.
    // Before the account, because `gifts.account_id` is ON DELETE SET NULL and
    // a gift row left with a `percent` but no account fails `gifts_event_kind`.
    for (const name of promotedEntityNames) {
      await db
        .delete(entities)
        .where(and(eq(entities.clientId, COOPER_CLIENT_ID), eq(entities.name, name)));
    }
    // `gifts.recipient_entity_id` is ON DELETE CASCADE, so dropping the test
    // trust takes every gift this test promoted with it.
    await db.delete(entities).where(eq(entities.id, trustId));
    await db.delete(accounts).where(eq(accounts.id, accountId));
    await db.delete(scenarios).where(eq(scenarios.id, scenarioId));
  });

  /** Run the promote write path for this scenario's overlay: real change rows →
   *  the real classifier → the real executor, inside a real transaction. This is
   *  the half of `promoteScenarioToBase` that drives PROMOTE_TABLE_REGISTRY; the
   *  rest of that function (snapshot, sibling-scenario deletion, audit) would
   *  rewrite a shared dev client's whole plan and proves nothing about gifts. */
  async function promoteOverlay(
    /** Re-orders the loaded change rows before classification. `loadScenarioChanges`
     *  has no ORDER BY, so the real promote sees them in Postgres row order —
     *  this is how a test pins that BOTH orders promote identically rather than
     *  waiting for the DB to happen to hand back the unlucky one. */
    orderRows?: (rows: ScenarioChange[]) => ScenarioChange[],
  ): Promise<Record<string, number>> {
    const rows = (await db
      .select()
      .from(scenarioChanges)
      .where(eq(scenarioChanges.scenarioId, scenarioId))) as unknown as ScenarioChange[];
    const plan = scenarioChangesToBaseWrites(
      minimalClientData(),
      orderRows ? orderRows(rows) : rows,
      [],
      {},
    );
    return db.transaction(async (tx) => {
      const { counts, idRemap } = await executeBaseWritePlan(tx, plan, {
        clientId: COOPER_CLIENT_ID,
        baseScenarioId,
      });
      // The scenario-PARTITIONED half of the same promote, in the order
      // `promote-to-base.ts` runs it. There is only one call to make: RULING 81
      // put the fold-then-copy order INSIDE the function precisely so that a
      // helper like this one cannot get it wrong.
      await copyGiftSeriesToBase(
        tx,
        { clientId: COOPER_CLIENT_ID, scenarioId, baseScenarioId },
        { ...plan.giftSeries, idRemap },
      );
      return counts;
    });
  }

  /** Hand the classifier the `gift` change FIRST, so the pre-fix executor is
   *  guaranteed to try the gift insert before the entity it depends on. */
  const giftFirst = (rows: ScenarioChange[]): ScenarioChange[] =>
    [...rows].sort((a, b) => Number(b.targetKind === "gift") - Number(a.targetKind === "gift"));

  /** Hand it the `entity` change first — the lucky order the pre-fix code
   *  sometimes got, which cause 2 (the un-remapped recipient id) still breaks. */
  const entityFirst = (rows: ScenarioChange[]): ScenarioChange[] =>
    [...rows].sort((a, b) => Number(b.targetKind === "entity") - Number(a.targetKind === "entity"));

  /** `liabilities` → `gifts.liability_id` is ON DELETE SET NULL, and a gift row
   *  with neither an account nor a liability but a `percent` fails the
   *  `gifts_event_kind` check — so the bundled children have to go first. */
  async function dropMortgage(liabilityId: string) {
    await db.delete(gifts).where(eq(gifts.liabilityId, liabilityId));
    await db.delete(liabilities).where(eq(liabilities.id, liabilityId));
  }

  async function promotedGifts() {
    return db.select().from(gifts).where(eq(gifts.recipientEntityId, trustId));
  }

  it("carries a cash gift's recipient, Crummey flag and amount onto the base row", async () => {
    const giftId = randomUUID();
    await applyEntityAdd({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "gift",
      entity: {
        id: giftId,
        kind: "cash-once",
        year: 2030,
        amount: 50_000,
        grantor: "spouse",
        recipient: { kind: "entity", id: trustId },
        crummey: true,
        valuationDiscount: 0.25,
      },
    });

    const counts = await promoteOverlay();
    expect(counts.gift).toBe(1);

    const rows = await promotedGifts();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    // The three fields the draft→row translation exists for.
    expect(row.recipientEntityId).toBe(trustId);
    expect(row.useCrummeyPowers).toBe(true);
    expect(row.amount).toBe("50000.00"); // numeric comes back as a string
    // …and the rest of the row, so a half-translation cannot pass.
    expect(row.recipientFamilyMemberId).toBeNull();
    expect(row.recipientExternalBeneficiaryId).toBeNull();
    expect(row.clientId).toBe(COOPER_CLIENT_ID);
    expect(row.year).toBe(2030);
    expect(row.grantor).toBe("spouse");
    expect(row.valuationDiscount).toBe("0.2500");
    expect(row.accountId).toBeNull();
    expect(row.percent).toBeNull();
    // The gift keeps the id its change names. That is what lets an edit of a
    // base gift land on the base row instead of beside it — see the
    // in-place-update test below.
    expect(row.id).toBe(giftId);
  });

  it("carries an asset gift's account, share and manual valuation override", async () => {
    const giftId = randomUUID();
    await applyEntityAdd({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "gift",
      entity: {
        id: giftId,
        kind: "asset-once",
        year: 2027,
        accountId,
        percent: 0.15,
        grantor: "client",
        recipient: { kind: "entity", id: trustId },
        // `amountOverride` is the advisor's manual valuation; it lands on the
        // row's `amount` column, which has no matching draft key at all.
        amountOverride: 123_456,
        valuationDiscount: 0.3,
      },
    });

    await promoteOverlay();

    const [row] = await promotedGifts();
    expect(row).toBeDefined();
    expect(row.recipientEntityId).toBe(trustId);
    expect(row.accountId).toBe(accountId);
    expect(row.percent).toBe("0.1500");
    expect(row.amount).toBe("123456.00");
    expect(row.valuationDiscount).toBe("0.3000");
    // Asset gifts carry no Crummey concept.
    expect(row.useCrummeyPowers).toBe(false);
  });

  it("lands the bundled liability transfer beside a promoted asset gift", async () => {
    // THE DEFECT. `POST /gifts` inserts TWO rows for an asset transfer whose
    // account carries a mortgage: the gift, and a bundled child with
    // `liabilityId` set and `parentGiftId` pointing at it. A scenario bypasses
    // that route, and while the scenario is live the overlay synthesises the
    // matching liability event from `linkedPropertyId` — so the scenario's
    // numbers are right. Promotion emitted one row, and the projection loader
    // builds liability gift events from STORED rows with `liabilityId != null`.
    // So the property left the estate on promote and 30% of its mortgage
    // silently stayed with the household.
    const [mortgage] = await db
      .insert(liabilities)
      .values({
        clientId: COOPER_CLIENT_ID,
        scenarioId: baseScenarioId,
        name: "promote-gift-test-mortgage",
        balance: "400000",
        startYear: 2020,
        linkedPropertyId: accountId,
      })
      .returning();

    try {
      const giftId = randomUUID();
      await applyEntityAdd({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "gift",
        entity: {
          id: giftId,
          kind: "asset-once",
          year: 2028,
          accountId,
          percent: 0.3,
          grantor: "client",
          recipient: { kind: "entity", id: trustId },
        },
      });

      await promoteOverlay();

      const rows = await promotedGifts();
      expect(rows).toHaveLength(2);

      const parent = rows.find((r) => r.id === giftId);
      const child = rows.find((r) => r.id !== giftId);
      expect(parent).toBeDefined();
      expect(child).toBeDefined();

      // The child points at the mortgage and at its own parent — the two
      // columns the loader reads to rebuild the liability gift event.
      expect(child!.liabilityId).toBe(mortgage.id);
      expect(child!.parentGiftId).toBe(giftId);
      expect(child!.accountId).toBeNull();
      // …and agrees with the parent on everything the event carries.
      expect(child!.percent).toBe("0.3000");
      expect(child!.year).toBe(2028);
      expect(child!.grantor).toBe("client");
      expect(child!.recipientEntityId).toBe(trustId);
      expect(child!.clientId).toBe(COOPER_CLIENT_ID);
      expect(child!.amount).toBeNull();
      expect(child!.useCrummeyPowers).toBe(false);
      // A liability transfer contributes $0 to the gift ledger, so a discount
      // on it would be dead data — and a double count against the parent's.
      expect(child!.valuationDiscount).toBeNull();

      // The parent is unchanged by the child write.
      expect(parent!.accountId).toBe(accountId);
      expect(parent!.liabilityId).toBeNull();
      expect(parent!.parentGiftId).toBeNull();
    } finally {
      await dropMortgage(mortgage.id);
    }
  });

  it("rewrites the bundled child on a re-promote instead of stacking a second one", async () => {
    // A gift has no `edit` op, so editing a base asset gift is an `add` on its
    // own id and the parent is UPDATEd in place. Appending the child instead of
    // rewriting it would leave the plan with two mortgage transfers for one
    // property — and the stale one would keep the OLD year and percent.
    const [mortgage] = await db
      .insert(liabilities)
      .values({
        clientId: COOPER_CLIENT_ID,
        scenarioId: baseScenarioId,
        name: "promote-gift-test-mortgage-2",
        balance: "250000",
        startYear: 2020,
        linkedPropertyId: accountId,
      })
      .returning();

    try {
      const giftId = randomUUID();
      const add = (year: number, percent: number) =>
        applyEntityAdd({
          scenarioId,
          firmId: COOPER_FIRM_ID,
          targetKind: "gift",
          entity: {
            id: giftId,
            kind: "asset-once",
            year,
            accountId,
            percent,
            grantor: "client",
            recipient: { kind: "entity", id: trustId },
          },
        });

      await add(2028, 0.3);
      await promoteOverlay();
      await add(2029, 0.45); // the edit, re-promoted
      await promoteOverlay();

      const rows = await promotedGifts();
      expect(rows).toHaveLength(2); // one parent, one child — not three
      const child = rows.find((r) => r.id !== giftId)!;
      expect(child.liabilityId).toBe(mortgage.id);
      // The child followed the edit rather than keeping 2028 / 30%.
      expect(child.year).toBe(2029);
      expect(child.percent).toBe("0.4500");
    } finally {
      await dropMortgage(mortgage.id);
    }
  });

  it("writes no bundled child for an asset gift whose account has no linked liability", async () => {
    // The inert half, asserted rather than assumed: the child writer now runs
    // for EVERY promoted gift, so "nothing happens" has to be a measured fact.
    const giftId = randomUUID();
    await applyEntityAdd({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "gift",
      entity: {
        id: giftId,
        kind: "asset-once",
        year: 2028,
        accountId,
        percent: 0.3,
        grantor: "client",
        recipient: { kind: "entity", id: trustId },
      },
    });

    await promoteOverlay();

    const rows = await promotedGifts();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(giftId);
  });

  it("never lands a recurring series in the `gifts` table", async () => {
    // The solver's estate editor still offers Recurring and records it as a
    // `gift` change (so do legacy scenarios). It used to reach the one-table-
    // per-kind executor, where it threw by name and rolled the WHOLE promote
    // back — a scenario holding a recurring gift could not be promoted at all.
    // It now goes to `gift_series` (see the series tests at the bottom of this
    // file); what must never happen is a series row in `gifts`, where it would
    // die on the NOT NULL `year` column or land as a one-time gift.
    const seriesId = randomUUID();
    await applyEntityAdd({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "gift",
      entity: {
        id: seriesId,
        kind: "series",
        startYear: 2027,
        endYear: 2031,
        annualAmount: 19_000,
        amountMode: "fixed",
        inflationAdjust: false,
        grantor: "client",
        recipient: { kind: "entity", id: trustId },
        crummey: true,
      },
    });

    const counts = await promoteOverlay();

    expect(await promotedGifts()).toHaveLength(0);
    // …and it was not counted as a `gifts` write either: the classifier took it
    // out of plan.inserts entirely.
    expect(counts.gift).toBeUndefined();
    // It landed where it belongs. (The columns are asserted by the series
    // tests; this one is about the table it did NOT go to.)
    const series = await db
      .select()
      .from(giftSeries)
      .where(
        and(
          eq(giftSeries.clientId, COOPER_CLIENT_ID),
          eq(giftSeries.scenarioId, baseScenarioId),
          eq(giftSeries.recipientEntityId, trustId),
        ),
      );
    expect(series).toHaveLength(1);
    expect(series[0].startYear).toBe(2027);
  });

  it("carries a non-outright event kind instead of flattening it to outright", async () => {
    // A charitable lead trust's remainder-interest gift is a `gift-upsert` draft
    // carrying eventKind: "clt_remainder_interest"
    // (solver/split-interest-levers.ts:148). `gifts.event_kind` is NOT NULL
    // DEFAULT 'outright', so dropping the field does not leave a gap — it
    // silently converts the gift into an ordinary outright one and moves the
    // estate numbers. Asserting "outright" would prove nothing; only a
    // non-default value can fail.
    await applyEntityAdd({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "gift",
      entity: {
        id: randomUUID(),
        kind: "cash-once",
        year: 2029,
        amount: 250_000,
        grantor: "client",
        recipient: { kind: "entity", id: trustId },
        crummey: false,
        eventKind: "clt_remainder_interest",
      },
    });

    await promoteOverlay();

    const [row] = await promotedGifts();
    expect(row).toBeDefined();
    expect(row.eventKind).toBe("clt_remainder_interest");
  });

  it("updates a base gift in place rather than promoting a second copy of it", async () => {
    // THE REGRESSION. A gift has no `edit` op, so editing a base-plan gift is
    // written as an `add` on that gift's OWN id. Promotion used to mint a fresh
    // uuid for every add, which left the original row sitting beside the new
    // one: the scenario showed one $99,000 gift and promoting it produced the
    // $99,000 gift AND resurrected the un-edited $10,000 one.
    //
    // It updates rather than delete-then-inserts because `gifts.parent_gift_id`
    // is a self-FK with ON DELETE CASCADE — deleting the base row would take
    // its bundled liability-transfer children with it, and the re-materialised
    // draft cannot recreate them.
    const [baseGift] = await db
      .insert(gifts)
      .values({
        clientId: COOPER_CLIENT_ID,
        year: 2030,
        amount: "10000",
        grantor: "client",
        recipientEntityId: trustId,
        useCrummeyPowers: false,
      })
      .returning();

    await applyEntityAdd({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "gift",
      entity: {
        id: baseGift.id, // the EXISTING gift's id — this is an edit
        kind: "cash-once",
        year: 2030,
        amount: 99_000,
        grantor: "client",
        recipient: { kind: "entity", id: trustId },
        crummey: true,
      },
    });

    await promoteOverlay();

    const rows = await promotedGifts();
    expect(rows.map((r) => r.amount)).toEqual(["99000.00"]); // exactly one gift
    expect(rows[0].id).toBe(baseGift.id); // the same row, edited in place
    expect(rows[0].useCrummeyPowers).toBe(true);
  });

  it("keeps the base gift's note when an edit of it is promoted", async () => {
    // The in-place UPDATE above turned a harmless placeholder into a data-loss
    // path: `EstateFlowGift` has no notes field, so `giftDraftToRow` emits
    // `notes: null`, which on an INSERT is just the column default but on an
    // UPDATE would wipe whatever the advisor had written on the base row. The
    // promotion translator drops the key entirely so the column is left alone.
    const [baseGift] = await db
      .insert(gifts)
      .values({
        clientId: COOPER_CLIENT_ID,
        year: 2031,
        amount: "20000",
        grantor: "client",
        recipientEntityId: trustId,
        useCrummeyPowers: false,
        notes: "Funded from the 2031 annual exclusion — see engagement memo.",
      })
      .returning();

    await applyEntityAdd({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "gift",
      entity: {
        id: baseGift.id,
        kind: "cash-once",
        year: 2031,
        amount: 45_000, // the edit
        grantor: "client",
        recipient: { kind: "entity", id: trustId },
        crummey: false,
      },
    });

    await promoteOverlay();

    const [row] = await promotedGifts();
    expect(row.amount).toBe("45000.00"); // the edit landed…
    expect(row.notes).toBe(
      "Funded from the 2031 annual exclusion — see engagement memo.",
    ); // …without eating the note
  });

  it("writes the gift the change TARGETS, not whatever id its payload carries", async () => {
    // `desiredFields` is unconstrained and `applyEntityEdit` merges it into the
    // add row's payload (changes-writer.ts:219-236), so a change's `targetId`
    // and its payload's `id` can genuinely disagree. The overlay strips by
    // targetId, so promotion must write by targetId too — otherwise it rewrites
    // a bystander gift and leaves the targeted one untouched, which is the exact
    // overlay/promote divergence the id-preserving upsert exists to close.
    //
    // The row is inserted directly because `applyEntityAdd` always sets
    // `targetId: entity.id`; only the edit-merge path can produce the skew.
    const [targeted] = await db
      .insert(gifts)
      .values({
        clientId: COOPER_CLIENT_ID,
        year: 2033,
        amount: "1000",
        grantor: "client",
        recipientEntityId: trustId,
        useCrummeyPowers: false,
      })
      .returning();
    const [bystander] = await db
      .insert(gifts)
      .values({
        clientId: COOPER_CLIENT_ID,
        year: 2034,
        amount: "7000",
        grantor: "client",
        recipientEntityId: trustId,
        useCrummeyPowers: false,
      })
      .returning();

    await db.insert(scenarioChanges).values({
      scenarioId,
      opType: "add",
      targetKind: "gift",
      targetId: targeted.id,
      payload: {
        id: bystander.id, // the skew
        kind: "cash-once",
        year: 2033,
        amount: 88_000,
        grantor: "client",
        recipient: { kind: "entity", id: trustId },
        crummey: false,
      },
    });

    await promoteOverlay();

    const byId = new Map((await promotedGifts()).map((r) => [r.id, r]));
    expect(byId.get(targeted.id)?.amount).toBe("88000.00"); // the targeted gift changed
    expect(byId.get(bystander.id)?.amount).toBe("7000.00"); // the bystander did not
    expect(byId.size).toBe(2); // and no third row appeared
  });

  it("never writes another client's gift row that happens to share the id", async () => {
    // ORG SCOPING. Preserving the id means the promote now UPDATEs by id, so
    // the scoping of that update is load-bearing: an unscoped upsert would
    // rewrite a row belonging to a different client. `scopeWhere` pins the
    // clientId, so a foreign id matches nothing, falls through to the insert
    // and collides loudly on the primary key — never a cross-tenant write.
    const foreignGiftId = randomUUID();
    await db.insert(gifts).values({
      id: foreignGiftId,
      clientId: OTHER_CLIENT_ID,
      year: 2035,
      amount: "4242",
      grantor: "client",
      recipientEntityId: trustId,
      useCrummeyPowers: false,
    });

    try {
      await applyEntityAdd({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "gift",
        entity: {
          id: foreignGiftId, // an id this client does not own
          kind: "cash-once",
          year: 2035,
          amount: 999_999,
          grantor: "client",
          recipient: { kind: "entity", id: trustId },
          crummey: true,
        },
      });

      await expect(promoteOverlay()).rejects.toThrow();

      // The other client's row is untouched: same owner, same amount.
      const [foreign] = await db
        .select()
        .from(gifts)
        .where(eq(gifts.id, foreignGiftId));
      expect(foreign.clientId).toBe(OTHER_CLIENT_ID);
      expect(foreign.amount).toBe("4242.00");
      expect(foreign.useCrummeyPowers).toBe(false);
    } finally {
      await db.delete(gifts).where(eq(gifts.id, foreignGiftId));
    }
  });

  it("leaves an already row-shaped gift payload alone", async () => {
    // Every gift `add` a current writer emits is a draft, but the translator
    // must not corrupt a payload that is already in column shape (a change row
    // written before the draft convention). `coerceForTable` alone handles
    // those correctly, so the translator passes them straight through.
    const giftId = randomUUID();
    await applyEntityAdd({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "gift",
      entity: {
        id: giftId,
        year: 2032,
        amount: 7_500,
        grantor: "client",
        recipientEntityId: trustId,
        useCrummeyPowers: true,
      },
    });

    await promoteOverlay();

    const [row] = await promotedGifts();
    expect(row).toBeDefined();
    expect(row.recipientEntityId).toBe(trustId);
    expect(row.useCrummeyPowers).toBe(true);
    expect(row.amount).toBe("7500.00");
    expect(row.year).toBe(2032);
  });

  it("leaves a base gift's bundled child alone when a ROW-SHAPED payload is promoted", async () => {
    // The inverse of the bundled-child fix. A row-shaped payload (a change row
    // written before the draft convention) says nothing about the gift's
    // children, so clearing them on its behalf destroys the base gift's bundled
    // liability transfer and never rebuilds it — the property keeps leaving the
    // estate while its mortgage stays with the household, which is the exact
    // defect the child writer exists to prevent.
    const [mortgage] = await db
      .insert(liabilities)
      .values({
        clientId: COOPER_CLIENT_ID,
        scenarioId: baseScenarioId,
        name: "promote-gift-test-mortgage",
        balance: "400000",
        startYear: 2020,
        linkedPropertyId: accountId,
      })
      .returning();

    try {
      const [parent] = await db
        .insert(gifts)
        .values({
          clientId: COOPER_CLIENT_ID,
          year: 2030,
          grantor: "client",
          recipientEntityId: trustId,
          accountId,
          percent: "0.2500",
        })
        .returning();
      const [child] = await db
        .insert(gifts)
        .values({
          clientId: COOPER_CLIENT_ID,
          year: 2030,
          grantor: "client",
          recipientEntityId: trustId,
          liabilityId: mortgage.id,
          percent: "0.2500",
          parentGiftId: parent.id,
          notes: `Auto-bundled with asset transfer of account ${accountId}`,
        })
        .returning();

      // Row-shaped, i.e. NO `kind` — the shape `isEstateFlowGiftDraft` rejects.
      await applyEntityAdd({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "gift",
        entity: {
          id: parent.id,
          year: 2031,
          grantor: "client",
          recipientEntityId: trustId,
          accountId,
          percent: 0.25,
        },
      });

      await promoteOverlay();

      const rows = await promotedGifts();
      // The parent still promoted (the year moved), and the child it never
      // spoke about is untouched.
      expect(rows.find((r) => r.id === parent.id)?.year).toBe(2031);
      const survivor = rows.find((r) => r.id === child.id);
      expect(survivor).toBeDefined();
      expect(survivor!.liabilityId).toBe(mortgage.id);
      expect(survivor!.parentGiftId).toBe(parent.id);
    } finally {
      await dropMortgage(mortgage.id);
    }
  });

  it("leaves the bundled child's event kind at the column default, exactly as the gift route does", async () => {
    // The child is a DEBT transfer, not the parent's transfer-tax event, so it
    // must not inherit a `clt_remainder_interest` parent's treatment.
    // `POST /gifts` omits the column on its own bundled child and lets the
    // `outright` default stand; promotion has to land the same row.
    const [mortgage] = await db
      .insert(liabilities)
      .values({
        clientId: COOPER_CLIENT_ID,
        scenarioId: baseScenarioId,
        name: "promote-gift-test-mortgage",
        balance: "400000",
        startYear: 2020,
        linkedPropertyId: accountId,
      })
      .returning();

    try {
      const giftId = randomUUID();
      await applyEntityAdd({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "gift",
        entity: {
          id: giftId,
          kind: "asset-once",
          year: 2028,
          accountId,
          percent: 0.3,
          grantor: "client",
          recipient: { kind: "entity", id: trustId },
          eventKind: "clt_remainder_interest",
        },
      });

      await promoteOverlay();

      const rows = await promotedGifts();
      expect(rows).toHaveLength(2);
      // The parent keeps its non-default kind (that rule is pinned elsewhere);
      // only a non-default parent can make the child's value fail.
      expect(rows.find((r) => r.id === giftId)?.eventKind).toBe("clt_remainder_interest");
      expect(rows.find((r) => r.id !== giftId)?.eventKind).toBe("outright");
    } finally {
      await dropMortgage(mortgage.id);
    }
  });

  // ── A trust the scenario itself created ────────────────────────────────────
  //
  // THE DEFECT, measured on prod: both of the two `gift` change rows that exist
  // recipient an entity id that is also an `entity` ADD in the same scenario and
  // does not exist in `entities`. Promoting either FK-violated and rolled the
  // whole transaction back, so the only gift-carrying scenario flow on prod
  // could never be promoted. Two independent causes: the executor ranked
  // `entity` and `gift` in the same bucket (so which inserted first was Postgres
  // row order), and the synthetic entity id was never remapped — the gift's
  // recipient is NESTED in the draft and only becomes a column after translation.

  /** The entity row a promote minted for a scenario-created trust. Looked up by
   *  name because its id is generated inside the promote transaction. */
  async function promotedEntityByName(name: string) {
    const [row] = await db
      .select()
      .from(entities)
      .where(and(eq(entities.clientId, COOPER_CLIENT_ID), eq(entities.name, name)));
    return row;
  }

  /** Register a scenario-only trust `add` and return the name + synthetic id the
   *  gift will recipient. The name is tracked for teardown before anything runs. */
  async function addScenarioTrust(): Promise<{ syntheticId: string; name: string }> {
    const syntheticId = randomUUID();
    const name = `promote-gift-test-new-trust-${randomUUID().slice(0, 8)}`;
    promotedEntityNames.push(name);
    await applyEntityAdd({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "entity",
      entity: { id: syntheticId, name, entityType: "trust" },
    });
    return { syntheticId, name };
  }

  it("promotes a gift to a trust the SAME scenario created, pointed at the new entity row", async () => {
    const { syntheticId, name } = await addScenarioTrust();
    const giftId = randomUUID();
    await applyEntityAdd({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "gift",
      entity: {
        id: giftId,
        kind: "cash-once",
        year: 2030,
        amount: 75_000,
        grantor: "client",
        recipient: { kind: "entity", id: syntheticId },
        crummey: true,
      },
    });

    const counts = await promoteOverlay(giftFirst);
    expect(counts.entity).toBe(1);
    expect(counts.gift).toBe(1);

    const trust = await promotedEntityByName(name);
    expect(trust).toBeDefined();
    // `entity` does not preserve the change's id, so the DB minted a fresh one.
    expect(trust.id).not.toBe(syntheticId);

    const [row] = await db.select().from(gifts).where(eq(gifts.id, giftId));
    expect(row).toBeDefined();
    // The whole point: the promoted gift points at the ENTITIES ROW'S new id —
    // not the synthetic one, and not merely "the promote did not throw".
    expect(row.recipientEntityId).toBe(trust.id);
    expect(row.recipientEntityId).not.toBe(syntheticId);
    expect(row.amount).toBe("75000.00");
    expect(row.useCrummeyPowers).toBe(true);
  });

  it("promotes that scenario whichever order the two change rows come back in", async () => {
    // `loadScenarioChanges` has no ORDER BY, so which of the two inserts first is
    // Postgres row order. Ranking by kind is what makes that stop mattering.
    const { syntheticId, name } = await addScenarioTrust();
    const giftId = randomUUID();
    await applyEntityAdd({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "gift",
      entity: {
        id: giftId,
        kind: "cash-once",
        year: 2032,
        amount: 42_000,
        grantor: "client",
        recipient: { kind: "entity", id: syntheticId },
        crummey: false,
      },
    });

    const promoteThenReset = async (
      order: (rows: ScenarioChange[]) => ScenarioChange[],
    ) => {
      await promoteOverlay(order);
      const trust = await promotedEntityByName(name);
      const [gift] = await db.select().from(gifts).where(eq(gifts.id, giftId));
      const seen = {
        trustId: trust?.id ?? null,
        recipientEntityId: gift?.recipientEntityId ?? null,
        amount: gift?.amount ?? null,
      };
      // Back to the pre-promote state for the second run. The entity delete
      // cascades the gift it recipients, so both rows go.
      await db
        .delete(entities)
        .where(and(eq(entities.clientId, COOPER_CLIENT_ID), eq(entities.name, name)));
      return seen;
    };

    const withGiftFirst = await promoteThenReset(giftFirst);
    const withEntityFirst = await promoteThenReset(entityFirst);

    for (const seen of [withGiftFirst, withEntityFirst]) {
      expect(seen.trustId).not.toBeNull();
      expect(seen.recipientEntityId).toBe(seen.trustId);
      expect(seen.recipientEntityId).not.toBe(syntheticId);
      expect(seen.amount).toBe("42000.00");
    }
    // Same result both ways — the two runs differ only in the generated id.
    expect(withGiftFirst.trustId).not.toBe(withEntityFirst.trustId);
  });

  it("points the bundled liability transfer at the scenario-created trust too", async () => {
    // The child writer builds its three recipient columns straight from
    // `raw.recipient.id`, so without its own remap it re-opens the very FK
    // violation the parent just stopped hitting — and the whole promote
    // still rolls back.
    const [mortgage] = await db
      .insert(liabilities)
      .values({
        clientId: COOPER_CLIENT_ID,
        scenarioId: baseScenarioId,
        name: "promote-gift-test-mortgage-new-trust",
        balance: "400000",
        startYear: 2020,
        linkedPropertyId: accountId,
      })
      .returning();

    try {
      const { syntheticId, name } = await addScenarioTrust();
      const giftId = randomUUID();
      await applyEntityAdd({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "gift",
        entity: {
          id: giftId,
          kind: "asset-once",
          year: 2029,
          accountId,
          percent: 0.3,
          grantor: "client",
          recipient: { kind: "entity", id: syntheticId },
        },
      });

      await promoteOverlay(giftFirst);

      const trust = await promotedEntityByName(name);
      expect(trust).toBeDefined();
      const rows = await db
        .select()
        .from(gifts)
        .where(eq(gifts.recipientEntityId, trust.id));
      expect(rows).toHaveLength(2);

      const parent = rows.find((r) => r.id === giftId);
      const child = rows.find((r) => r.id !== giftId);
      expect(parent).toBeDefined();
      expect(child).toBeDefined();
      expect(parent!.recipientEntityId).toBe(trust.id);
      expect(child!.recipientEntityId).toBe(trust.id);
      expect(child!.liabilityId).toBe(mortgage.id);
      expect(child!.parentGiftId).toBe(giftId);
      expect(child!.percent).toBe("0.3000");
    } finally {
      await dropMortgage(mortgage.id);
    }
  });

  // ── A recurring SERIES the solver wrote (RULING 56 / 77 / 81) ──────────────
  //
  // The solver's estate tab still offers Recurring, and it has no DB access at
  // edit time, so a series it creates is saved as a `gift` change carrying a
  // series draft. `gift_series` is scenario-PARTITIONED and is not a TargetKind,
  // so promotion folds those changes into the PROMOTED SCENARIO's own partition
  // and lets the copy carry the result into base — the same composition the
  // projection does (`partition rows + gift-change overlay`), in the same order.

  /** A series draft exactly as `gift-upsert` → `mutations-to-scenario-changes`
   *  records it: the full `EstateFlowGift`, nested recipient and all. */
  const seriesDraft = (over: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    kind: "series" as const,
    startYear: 2027,
    endYear: 2031,
    annualAmount: 19_000,
    amountMode: "annual_exclusion" as const,
    inflationAdjust: true,
    grantor: "spouse" as const,
    recipient: { kind: "entity" as const, id: trustId },
    crummey: true,
    ...over,
  });

  /** A real row in the PROMOTED SCENARIO's partition — what the series route
   *  writes when a series is created with `?scenario=` (RULING 68). */
  async function addPartitionSeries(over: Record<string, unknown> = {}) {
    const [row] = await db
      .insert(giftSeries)
      .values({
        clientId: COOPER_CLIENT_ID,
        scenarioId,
        grantor: "client",
        recipientEntityId: trustId,
        startYear: 2027,
        endYear: 2031,
        annualAmount: "19000",
        ...over,
      })
      .returning();
    return row;
  }

  /** The base plan's series for one recipient. Filtered by recipient rather
   *  than by client so a concurrent run of this file is never counted. */
  async function baseSeriesFor(recipientEntityId: string) {
    return db
      .select()
      .from(giftSeries)
      .where(
        and(
          eq(giftSeries.clientId, COOPER_CLIENT_ID),
          eq(giftSeries.scenarioId, baseScenarioId),
          eq(giftSeries.recipientEntityId, recipientEntityId),
        ),
      );
  }

  it("series: promotes a solver-written recurring series into the base plan", async () => {
    // THE HEADLINE. Before this, promoting the scenario threw by name at the
    // gift translator and rolled the whole thing back, so a scenario holding a
    // recurring gift could not be promoted at all.
    const draft = seriesDraft({ valuationDiscount: 0.3 });
    await applyEntityAdd({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "gift",
      entity: draft,
    });

    await promoteOverlay();

    const rows = await baseSeriesFor(trustId);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.grantor).toBe("spouse");
    expect(row.startYear).toBe(2027);
    expect(row.endYear).toBe(2031);
    expect(row.annualAmount).toBe("19000.00"); // numeric comes back as a string
    expect(row.amountMode).toBe("annual_exclusion");
    expect(row.inflationAdjust).toBe(true);
    expect(row.useCrummeyPowers).toBe(true);
    expect(row.valuationDiscount).toBe("0.3000");
    expect(row.recipientFamilyMemberId).toBeNull();
    expect(row.recipientExternalBeneficiaryId).toBeNull();
    // Base's copies are re-scoped with a FRESH id (`reScope` drops it), which
    // is exactly why the change is folded into the SCENARIO's partition first:
    // after the copy there is no id left for a targetId to name.
    expect(row.id).not.toBe(draft.id);
    // …and it landed in base, not merely in the scenario's own partition.
    expect(row.scenarioId).toBe(baseScenarioId);
  });

  it("series: a deleted series does not come back in base", async () => {
    // RULING 71. The solver's delete is a `remove` gift change; the overlay
    // hides the series from the editor and the projection, but the real
    // `gift_series` row stays alive in the scenario's partition and the copy
    // below resurrected it into base on promote — a gift the advisor deleted,
    // permanently restored by promoting.
    const partition = await addPartitionSeries();
    await applyEntityRemove({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "gift",
      targetId: partition.id,
    });

    await promoteOverlay();

    expect(await baseSeriesFor(trustId)).toHaveLength(0);
    // And it is gone from the scenario's partition too — that is what the copy
    // reads, so anything left there would have landed in base.
    const survivors = await db
      .select()
      .from(giftSeries)
      .where(eq(giftSeries.id, partition.id));
    expect(survivors).toHaveLength(0);
  });

  it("series: promoting an edit keeps the partition row's note and milestone anchor", async () => {
    // RULING 61's lesson, applied before it bites a second table. An
    // `EstateFlowGift` cannot represent `notes`, `start_year_ref` or
    // `end_year_ref`, so writing them as null on the UPDATE would erase the
    // advisor's own note and the milestone the start year is anchored to.
    const partition = await addPartitionSeries({
      notes: "Crummey letters mailed each January — see the trust binder.",
      startYearRef: "client_retirement",
      annualAmount: "12000",
    });

    await applyEntityAdd({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "gift",
      entity: seriesDraft({ id: partition.id, annualAmount: 25_000 }),
    });

    await promoteOverlay();

    const rows = await baseSeriesFor(trustId);
    expect(rows).toHaveLength(1); // edited in place, not added beside itself
    const [row] = rows;
    expect(row.annualAmount).toBe("25000.00"); // the edit landed…
    expect(row.notes).toBe(
      "Crummey letters mailed each January — see the trust binder.",
    ); // …without eating the note
    expect(row.startYearRef).toBe("client_retirement"); // …or the anchor
  });

  it("series: promotes a series to a trust the SAME scenario created", async () => {
    // The 56 × 60 intersection. The series names its recipient by the synthetic
    // id the change invented; the real `entities` row exists only under the
    // uuid the executor generated moments earlier in this same transaction.
    const { syntheticId, name } = await addScenarioTrust();
    await applyEntityAdd({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "gift",
      entity: seriesDraft({ recipient: { kind: "entity", id: syntheticId } }),
    });

    await promoteOverlay();

    const trust = await promotedEntityByName(name);
    expect(trust).toBeDefined();
    expect(trust.id).not.toBe(syntheticId);
    const rows = await baseSeriesFor(trust.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].recipientEntityId).toBe(trust.id);
    expect(rows[0].recipientEntityId).not.toBe(syntheticId);
    expect(rows[0].annualAmount).toBe("19000.00");
  });
});
