import { describe, it, expect, vi } from "vitest";
import { saveIncomeRows, isEmptyIncome, type IncomeRow } from "../income-save";
import type { QsContext } from "../derive";

const ctx = {
  milestones: {} as QsContext["milestones"],
  planStartYear: 2026,
  planEndYear: 2066,
  clientFirstName: "John",
  spouseFirstName: "Jane",
  hasSpouse: true,
} as QsContext;

function deps() {
  let n = 0;
  return {
    ctx,
    post: vi.fn(async () => ({ id: `srv-${++n}` })),
    put: vi.fn(async () => ({})),
    del: vi.fn(async () => ({})),
  };
}

describe("isEmptyIncome", () => {
  it("salary with no amount is empty; with amount is not", () => {
    expect(isEmptyIncome({ kind: "salary", owner: "client" })).toBe(true);
    expect(isEmptyIncome({ kind: "salary", owner: "client", amount: 1 })).toBe(false);
  });
  it("SS with no monthly benefit is empty", () => {
    expect(isEmptyIncome({ kind: "social_security", owner: "client" })).toBe(true);
    expect(
      isEmptyIncome({ kind: "social_security", owner: "client", monthlyBenefit: 2000 }),
    ).toBe(false);
  });
});

describe("saveIncomeRows", () => {
  it("POSTs a new non-empty row and assigns its serverId", async () => {
    const d = deps();
    const rows: IncomeRow[] = [{ _id: 1, kind: "salary", owner: "client", amount: 250000 }];
    const out = await saveIncomeRows(rows, [], d);
    expect(d.post).toHaveBeenCalledTimes(1);
    expect(out.rows[0].serverId).toBe("srv-1");
  });

  it("skips empty rows (no write, row kept)", async () => {
    const d = deps();
    const out = await saveIncomeRows([{ _id: 1, kind: "salary", owner: "client" }], [], d);
    expect(d.post).not.toHaveBeenCalled();
    expect(out.rows[0].serverId).toBeUndefined();
  });

  it("PUTs an existing row instead of POSTing", async () => {
    const d = deps();
    const rows: IncomeRow[] = [
      { _id: 1, serverId: "x", kind: "salary", owner: "client", amount: 9 },
    ];
    await saveIncomeRows(rows, [], d);
    expect(d.put).toHaveBeenCalledWith("x", expect.anything());
    expect(d.post).not.toHaveBeenCalled();
  });

  it("DELETEs ids in the deleted set", async () => {
    const d = deps();
    await saveIncomeRows([], ["gone"], d);
    expect(d.del).toHaveBeenCalledWith("gone");
  });

  it("SS with a serverId PUTs the ssPatch fields", async () => {
    const d = deps();
    const rows: IncomeRow[] = [
      { _id: 1, serverId: "ss1", kind: "social_security", owner: "client", monthlyBenefit: 2000 },
    ];
    await saveIncomeRows(rows, [], d);
    expect(d.put).toHaveBeenCalledWith(
      "ss1",
      expect.objectContaining({ piaMonthly: 2000, ssBenefitMode: "pia_at_fra" }),
    );
  });

  it("is idempotent: a second save of the returned rows POSTs nothing new", async () => {
    const d = deps();
    const first = await saveIncomeRows(
      [{ _id: 1, kind: "salary", owner: "client", amount: 5 }],
      [],
      d,
    );
    d.post.mockClear();
    await saveIncomeRows(first.rows, [], d);
    expect(d.post).not.toHaveBeenCalled();
    expect(d.put).toHaveBeenCalledTimes(1);
  });
});
