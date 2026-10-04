// The shared writer's `stress_test` guard. A stressor is saved whole — an
// `add` upserts it, a `remove` drops it, an `edit` is refused — and both
// checks run BEFORE any DB access. Fake `db`: the evidence is whether the
// writer touched the DB at all, and what payload it handed to the insert.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { STRESS_TEST_IDS } from "@/engine/stress-tests";

const SCENARIO_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const FIRM_ID = "org_test";

const crash = {
  kind: "market-crash", year: 2027, drawdownPct: 0.3,
  id: STRESS_TEST_IDS["market-crash"], name: "Market crash — 30% in 2027",
};

const { db, insertValues, conflictSet } = vi.hoisted(() => {
  const insertValues = vi.fn();
  const conflictSet = vi.fn();
  const db = {
    select: vi.fn(() => ({ from: () => ({ where: async () => [{ clientId: CLIENT_ID }] }) })),
    insert: vi.fn(() => ({
      values: (v: unknown) => {
        insertValues(v);
        return { onConflictDoUpdate: async (c: { set: unknown }) => { conflictSet(c.set); } };
      },
    })),
    transaction: vi.fn(async () => undefined),
  };
  return { db, insertValues, conflictSet };
});

vi.mock("@/db", () => ({ db }));
vi.mock("@/lib/db-scoping", () => ({ findClientInFirm: vi.fn(async () => ({ id: CLIENT_ID })) }));
vi.mock("../loader", () => ({ loadEffectiveTree: vi.fn(async () => ({ effectiveTree: { stressTests: [] } })) }));

const { applyEntityAdd, applyEntityEdit } = await import("../changes-writer");

beforeEach(() => vi.clearAllMocks());

function expectDbUntouched() {
  expect(db.select).not.toHaveBeenCalled();
  expect(db.insert).not.toHaveBeenCalled();
  expect(db.transaction).not.toHaveBeenCalled();
}

describe("changes-writer stress_test guard", () => {
  it("refuses a stress test carrying another kind's id before touching the DB", async () => {
    await expect(
      applyEntityAdd({
        scenarioId: SCENARIO_ID, firmId: FIRM_ID, targetKind: "stress_test",
        entity: { ...crash, id: STRESS_TEST_IDS.inflation },
      }),
    ).rejects.toThrow(/invalid stress_test/);
    expectDbUntouched();
  });

  it("refuses any stress_test edit before touching the DB", async () => {
    await expect(
      applyEntityEdit({
        scenarioId: SCENARIO_ID, firmId: FIRM_ID, targetKind: "stress_test",
        targetId: crash.id, desiredFields: { drawdownPct: 0.5 },
      }),
    ).rejects.toThrow(/stress_test has no edit/);
    expectDbUntouched();
  });

  it("stores the PARSED stressor on a valid add and on the re-save branch", async () => {
    const result = await applyEntityAdd({
      scenarioId: SCENARIO_ID, firmId: FIRM_ID, targetKind: "stress_test",
      entity: { ...crash, notAField: "dropped" },
    });
    expect(result).toEqual({ targetId: crash.id });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ opType: "add", targetKind: "stress_test", targetId: crash.id, payload: crash }),
    );
    expect(conflictSet).toHaveBeenCalledWith(expect.objectContaining({ payload: crash }));
  });
});
