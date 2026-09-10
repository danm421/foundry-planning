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
import { accounts, entities, gifts, scenarios, scenarioChanges } from "@/db/schema";
import type { ClientData } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";
import { applyEntityAdd } from "../changes-writer";
import { scenarioChangesToBaseWrites } from "../scenario-changes-to-base-writes";
import { executeBaseWritePlan } from "../execute-base-write-plan";
import { PROMOTE_TABLE_REGISTRY } from "../promote-table-registry";

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";

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

describe("PROMOTE_TABLE_REGISTRY — translator is gift-only", () => {
  // RULING 57's inertness claim, asserted rather than assumed: the executor now
  // calls `entry.translate` when present, so every other kind's behaviour is
  // unchanged only for as long as no other entry grows one silently.
  it("registers a translate hook for gift and for no other kind", () => {
    const withTranslate = Object.entries(PROMOTE_TABLE_REGISTRY)
      .filter(([, entry]) => entry?.translate !== undefined)
      .map(([kind]) => kind);
    expect(withTranslate).toEqual(["gift"]);
  });
});

describe.skipIf(!HAS_DB)("promote — a scenario `gift` add becomes a base gifts row", () => {
  let scenarioId: string;
  let baseScenarioId: string;
  let trustId: string;
  let accountId: string;

  beforeEach(async () => {
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
  async function promoteOverlay(): Promise<Record<string, number>> {
    const rows = await db
      .select()
      .from(scenarioChanges)
      .where(eq(scenarioChanges.scenarioId, scenarioId));
    const plan = scenarioChangesToBaseWrites(
      minimalClientData(),
      rows as unknown as ScenarioChange[],
      [],
      {},
    );
    return db.transaction((tx) =>
      executeBaseWritePlan(tx, plan, { clientId: COOPER_CLIENT_ID, baseScenarioId }),
    );
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
    // The executor mints a fresh uuid for every promoted add (it strips `id`),
    // so the base row is NOT the draft's id.
    expect(row.id).not.toBe(giftId);
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

  it("fails loudly, naming the gift, when a recurring series reaches gift promotion", async () => {
    // A series gift IS written as a `gift` change (transfer-series-form.tsx),
    // but `gift_series` is not a TargetKind and the executor has no per-row
    // table choice — so there is nowhere to put it. Inserting it into `gifts`
    // would die on the NOT NULL `year` column with an opaque DB error, and
    // dropping it would lose an advisor's gift in silence.
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

    await expect(promoteOverlay()).rejects.toThrow(seriesId);
    await expect(promoteOverlay()).rejects.toThrow(/series/i);
    // The transaction rolled back — nothing landed.
    expect(await promotedGifts()).toHaveLength(0);
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
});
