// src/lib/scenario/__tests__/changes-writer-gift-recipient.test.ts
//
// The shared writer refuses a scenario gift to a trust that is not irrevocable
// — the rule the base gift routes enforce with a 400. Fake `db`: the evidence
// is which rows the writer read and whether it reached the insert.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { entities, scenarioChanges, scenarios } from "@/db/schema";

const SCENARIO_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const TRUST_ID = "33333333-3333-4333-8333-333333333333";
const FIRM_ID = "org_test";

const { db, insertValues, rowsFor } = vi.hoisted(() => {
  const insertValues = vi.fn();
  /** Rows each table's select resolves to; reset per test. */
  const rowsFor = new Map<unknown, unknown[]>();
  const db = {
    select: vi.fn(() => ({
      from: (table: unknown) => ({ where: async () => rowsFor.get(table) ?? [] }),
    })),
    insert: vi.fn(() => ({
      values: (v: unknown) => {
        insertValues(v);
        return { onConflictDoUpdate: async () => undefined };
      },
    })),
  };
  return { db, insertValues, rowsFor };
});

vi.mock("@/db", () => ({ db }));
vi.mock("@/lib/db-scoping", () => ({
  findClientInFirm: vi.fn(async () => ({ id: CLIENT_ID })),
}));
vi.mock("../loader", () => ({ loadEffectiveTree: vi.fn() }));

import { applyEntityAdd, ScenarioChangeRejectedError } from "../changes-writer";

const giftTo = (recipient: { kind: string; id: string }) => ({
  id: "44444444-4444-4444-8444-444444444444",
  kind: "cash-once",
  year: 2030,
  amount: 75_000,
  grantor: "client",
  recipient,
  crummey: true,
});

const addGift = (recipient: { kind: string; id: string }) =>
  applyEntityAdd({
    scenarioId: SCENARIO_ID,
    firmId: FIRM_ID,
    targetKind: "gift",
    entity: giftTo(recipient),
  });

describe("changes-writer — a scenario gift's trust recipient must be irrevocable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rowsFor.clear();
    rowsFor.set(scenarios, [{ clientId: CLIENT_ID }]);
  });

  it.each([
    ["unset (NULL)", null],
    ["false", false],
  ])("refuses a base trust whose flag is %s, before any insert", async (_label, flag) => {
    rowsFor.set(entities, [{ entityType: "trust", isIrrevocable: flag }]);
    await expect(addGift({ kind: "entity", id: TRUST_ID })).rejects.toBeInstanceOf(
      ScenarioChangeRejectedError,
    );
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("refuses a trust the scenario itself added without the flag (the promote-gift fixture)", async () => {
    // The scenario's own `entity` add wins over the base table, where this
    // trust does not exist yet.
    rowsFor.set(scenarioChanges, [{ payload: { id: TRUST_ID, name: "New Trust", entityType: "trust" } }]);
    await expect(addGift({ kind: "entity", id: TRUST_ID })).rejects.toThrow(/revocable/i);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("refuses an entity that is not a trust, as the base route does", async () => {
    rowsFor.set(entities, [{ entityType: "llc", isIrrevocable: null }]);
    await expect(addGift({ kind: "entity", id: TRUST_ID })).rejects.toThrow(/must be a trust/i);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("writes a gift to an irrevocable trust — base row or scenario add", async () => {
    rowsFor.set(entities, [{ entityType: "trust", isIrrevocable: true }]);
    await addGift({ kind: "entity", id: TRUST_ID });
    rowsFor.delete(entities);
    rowsFor.set(scenarioChanges, [{ payload: { entityType: "trust", isIrrevocable: true } }]);
    await addGift({ kind: "entity", id: TRUST_ID });
    expect(insertValues).toHaveBeenCalledTimes(2);
  });

  it("writes a gift whose trust is not found yet — a batch may write the gift before its trust", async () => {
    await addGift({ kind: "entity", id: TRUST_ID });
    expect(insertValues).toHaveBeenCalledTimes(1);
  });

  it("does not look a family-member recipient up at all", async () => {
    await addGift({ kind: "family_member", id: TRUST_ID });
    expect(insertValues).toHaveBeenCalledTimes(1);
    // Only assertScenarioInFirm's scenario lookup ran.
    expect(db.select).toHaveBeenCalledTimes(1);
  });
});
