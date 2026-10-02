// src/lib/scenario/__tests__/changes-writer-ltc-event.test.ts
//
// The shared writer's `ltc_event` guard (Ruling R22). An LTC event is saved
// whole — an `add` upserts it, a `remove` drops it, and an `edit` is refused.
// The guard lives in the writer, not a route, because three callers reach it:
// the changes route, Forge `propose_changes`, and the Solver save. Both checks
// run BEFORE any DB access, so a refused write never reaches the database.
//
// Fake `db` rather than the live one: the evidence is whether the writer
// touched the DB at all, and what payload it handed to the insert.
import { describe, it, expect, vi, beforeEach } from "vitest";

const SCENARIO_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const FIRM_ID = "org_test";

const event = {
  id: "3f1c2d7e-8a1b-4c5d-9e0f-112233445566",
  name: "Long-term care — John 85–87",
  people: [
    { person: "client", startAge: 85, years: 3, careSetting: "nursing_private", annualCost: 129_575, costInflation: 0.05 },
  ],
  livingExpenseCutPct: 1,
  homeSale: null,
  includePolicies: true,
};

const { db, insertValues, conflictSet } = vi.hoisted(() => {
  const insertValues = vi.fn();
  const conflictSet = vi.fn();
  const db = {
    // assertScenarioInFirm's scenario lookup.
    select: vi.fn(() => ({
      from: () => ({ where: async () => [{ clientId: CLIENT_ID }] }),
    })),
    insert: vi.fn(() => ({
      values: (v: unknown) => {
        insertValues(v);
        return {
          onConflictDoUpdate: async (c: { set: unknown }) => {
            conflictSet(c.set);
          },
        };
      },
    })),
    // An edit runs inside a transaction; resolving without running it is
    // enough to show the writer got that far.
    transaction: vi.fn(async () => undefined),
  };
  return { db, insertValues, conflictSet };
});

vi.mock("@/db", () => ({ db }));
vi.mock("@/lib/db-scoping", () => ({
  findClientInFirm: vi.fn(async () => ({ id: CLIENT_ID })),
}));
vi.mock("../loader", () => ({
  loadEffectiveTree: vi.fn(async () => ({ effectiveTree: { ltcEvents: [] } })),
}));

const { applyEntityAdd, applyEntityEdit } = await import("../changes-writer");

beforeEach(() => {
  vi.clearAllMocks();
});

function expectDbUntouched() {
  expect(db.select).not.toHaveBeenCalled();
  expect(db.insert).not.toHaveBeenCalled();
  expect(db.transaction).not.toHaveBeenCalled();
}

describe("changes-writer ltc_event guard", () => {
  it("refuses an invalid ltc_event add (no one in care) before touching the DB", async () => {
    await expect(
      applyEntityAdd({
        scenarioId: SCENARIO_ID,
        firmId: FIRM_ID,
        targetKind: "ltc_event",
        entity: { ...event, people: [] },
      }),
    ).rejects.toThrow(/invalid ltc_event/);
    expectDbUntouched();
  });

  it("refuses any ltc_event edit before touching the DB — the event is re-saved whole as an add", async () => {
    await expect(
      applyEntityEdit({
        scenarioId: SCENARIO_ID,
        firmId: FIRM_ID,
        targetKind: "ltc_event",
        targetId: event.id,
        desiredFields: { name: "Renamed" },
      }),
    ).rejects.toThrow(/ltc_event has no edit/);
    expectDbUntouched();
  });

  it("stores the PARSED event on a valid add, so an unknown key never reaches the payload", async () => {
    const result = await applyEntityAdd({
      scenarioId: SCENARIO_ID,
      firmId: FIRM_ID,
      targetKind: "ltc_event",
      entity: { ...event, notAField: "dropped" },
    });

    expect(result).toEqual({ targetId: event.id });
    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ opType: "add", targetKind: "ltc_event", targetId: event.id, payload: event }),
    );
    // The re-save (upsert conflict) branch stores the same parsed payload.
    expect(conflictSet).toHaveBeenCalledWith(expect.objectContaining({ payload: event }));
  });
});
