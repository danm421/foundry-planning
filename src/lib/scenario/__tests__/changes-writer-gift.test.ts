// src/lib/scenario/__tests__/changes-writer-gift.test.ts
//
// The server half of the Details → Profile scenario-only gift fix. A gift the
// solver saved into a scenario has no base `gifts` row and often points at a
// trust with no base `entities` row, so the base gift routes cannot store an
// edit of it (`gifts.recipient_entity_id` alone carries an FK that forbids the
// recipient). The dialog therefore writes it as a `gift` scenario change — this
// pins that the writer stores it the way the overlay reads it back.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios, scenarioChanges } from "@/db/schema";
import { applyEntityAdd, applyEntityEdit, applyEntityRemove } from "../changes-writer";
import { partitionGiftChanges } from "../apply-gift-overlays";
import type { ScenarioChange } from "@/engine/scenario/types";

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";

const HAS_DB = !!process.env.DATABASE_URL;

/** A solver-shaped asset gift draft: 15% of an account to a trust that itself
 *  exists only as a scenario `entity` add. `valuationDiscount` is the LAST KEY
 *  by contract (see estate-flow-gift-diff.ts). */
function giftDraft(id: string, trustId: string, over: Record<string, unknown> = {}) {
  return {
    id,
    kind: "asset-once",
    year: 2026,
    grantor: "client",
    percent: 0.15,
    accountId: randomUUID(),
    recipient: { id: trustId, kind: "entity" },
    valuationDiscount: 0.25,
    ...over,
  };
}

describe.skipIf(!HAS_DB)("changes-writer — gift target kind", () => {
  let scenarioId: string;

  beforeEach(async () => {
    const [row] = await db
      .insert(scenarios)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `gift-writer-test-${randomUUID().slice(0, 8)}`,
        isBaseCase: false,
      })
      .returning();
    scenarioId = row.id;
  });

  afterEach(async () => {
    await db.delete(scenarios).where(eq(scenarios.id, scenarioId));
  });

  async function giftRows() {
    return db
      .select()
      .from(scenarioChanges)
      .where(
        and(
          eq(scenarioChanges.scenarioId, scenarioId),
          eq(scenarioChanges.targetKind, "gift"),
        ),
      );
  }

  it("folds an edit of a scenario-added gift into the add row instead of stacking an edit row", async () => {
    const giftId = randomUUID();
    const trustId = randomUUID(); // scenario-only trust: no base `entities` row
    await applyEntityAdd({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "gift",
      entity: giftDraft(giftId, trustId),
    });

    // The advisor reopens the gift in Details → Profile and changes the share
    // and the discount. This is the save that used to 400 with "Recipient
    // entity not found for this client".
    await applyEntityEdit({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "gift",
      targetId: giftId,
      desiredFields: giftDraft(giftId, trustId, { percent: 0.2, valuationDiscount: 0.3 }),
    });

    const rows = await giftRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].opType).toBe("add");

    const payload = rows[0].payload as Record<string, unknown>;
    expect(payload.percent).toBe(0.2);
    expect(payload.valuationDiscount).toBe(0.3);
    // Still a whole draft, not a {from,to} field diff — the overlay re-materialises it.
    expect(payload.kind).toBe("asset-once");
    expect(payload.recipient).toEqual({ id: trustId, kind: "entity" });
    // LAST KEY contract survives the merge.
    const keys = Object.keys(payload);
    expect(keys[keys.length - 1]).toBe("valuationDiscount");

    // And the overlay the Profile page renders still recognises it as a draft.
    const { adds, targeted } = partitionGiftChanges(rows as unknown as ScenarioChange[]);
    expect(targeted.has(giftId)).toBe(true);
    expect(adds).toHaveLength(1);
    expect(adds[0].id).toBe(giftId);
  });

  it("clearing the discount to null overwrites the stored value rather than keeping it", async () => {
    const giftId = randomUUID();
    const trustId = randomUUID();
    await applyEntityAdd({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "gift",
      entity: giftDraft(giftId, trustId),
    });
    await applyEntityEdit({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "gift",
      targetId: giftId,
      desiredFields: giftDraft(giftId, trustId, { valuationDiscount: null }),
    });

    const rows = await giftRows();
    expect((rows[0].payload as Record<string, unknown>).valuationDiscount).toBeNull();
  });

  it("removing a scenario-added gift drops the add row and leaves a remove marker (the Profile delete)", async () => {
    const giftId = randomUUID();
    const trustId = randomUUID();
    await applyEntityAdd({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "gift",
      entity: giftDraft(giftId, trustId),
    });
    expect(await giftRows()).toHaveLength(1);

    await applyEntityRemove({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "gift",
      targetId: giftId,
    });

    // The `add` is gone, so nothing re-materialises. The `remove` marker stays:
    // for a gift, `hasAdd` does NOT mean "scenario-only" (gifts have no `edit`
    // op, so editing a BASE gift also writes an `add` on its id), and dropping
    // the marker too is what would resurrect the base row. Here there is no
    // base row, so the marker is a harmless no-op — it strips an id that is
    // not in the list.
    const rows = await giftRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].opType).toBe("remove");

    const { adds, targeted } = partitionGiftChanges(rows as unknown as ScenarioChange[]);
    expect(adds).toHaveLength(0);
    expect(targeted.has(giftId)).toBe(true);
  });

  // THE REGRESSION. Before this, `applyEntityRemove` saw the `add` row, assumed
  // the gift was scenario-only, deleted every row for it and wrote no marker.
  // Nothing targeted the id any more, so the overlay stopped stripping the base
  // row and the gift came back — un-edited — in both the Profile list and the
  // projection, while the route answered ok and the UI showed it deleted.
  it("editing a BASE gift in a scenario and then deleting it leaves the gift gone, not resurrected", async () => {
    // A base-plan gift: it has a row in the `gifts` table, so its id exists
    // outside the scenario. Editing it here writes an `add` on that same id —
    // that is how a gift edit replaces the base row (there is no `edit` op).
    const baseGiftId = randomUUID();
    const trustId = randomUUID();
    await applyEntityAdd({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "gift",
      entity: giftDraft(baseGiftId, trustId, { percent: 0.2 }),
    });

    await applyEntityRemove({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "gift",
      targetId: baseGiftId,
    });

    const rows = await giftRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].opType).toBe("remove");

    // What the overlay does with that: the base row is stripped (the id is
    // targeted) and nothing is put back (no add payload). The gift is gone.
    const { adds, targeted } = partitionGiftChanges(rows as unknown as ScenarioChange[]);
    expect(targeted.has(baseGiftId)).toBe(true);
    expect(adds).toHaveLength(0);

    // Proof against the two half-fixes: keeping the add row would
    // re-materialise the EDITED gift, and dropping the marker would let the
    // un-edited base row back in.
    const baseGifts: Array<{ id: string }> = [{ id: baseGiftId }, { id: randomUUID() }];
    const surviving: string[] = [
      ...baseGifts.filter((g) => !targeted.has(g.id)).map((g) => g.id),
      ...adds.map((a) => a.id),
    ];
    expect(surviving).not.toContain(baseGiftId);
    expect(surviving).toHaveLength(1);
  });
});
