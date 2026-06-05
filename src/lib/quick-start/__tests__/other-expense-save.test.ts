import { describe, it, expect, vi } from "vitest";
import {
  saveOtherExpenseRows,
  isEmptyOtherExpense,
  type OtherExpenseRow,
} from "../other-expense-save";
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

describe("isEmptyOtherExpense", () => {
  it("name empty and amount undefined is empty", () => {
    expect(isEmptyOtherExpense({ _id: 1, name: "", amount: undefined })).toBe(true);
  });
  it("name filled is not empty", () => {
    expect(isEmptyOtherExpense({ _id: 1, name: "Travel" })).toBe(false);
  });
  it("amount filled (name empty) is not empty", () => {
    expect(isEmptyOtherExpense({ _id: 1, name: "", amount: 5000 })).toBe(false);
  });
});

describe("saveOtherExpenseRows", () => {
  it("POSTs new row, assigns serverId, body type===other and annualAmount===5000", async () => {
    const d = deps();
    const rows: OtherExpenseRow[] = [{ _id: 1, name: "Travel", amount: 5000 }];
    const out = await saveOtherExpenseRows(rows, [], d);
    expect(d.post).toHaveBeenCalledTimes(1);
    expect(out.rows[0].serverId).toBe("srv-1");

    const body = d.post.mock.calls[0][0] as { type: string; annualAmount: number };
    expect(body.type).toBe("other");
    expect(body.annualAmount).toBe(5000);
  });

  it("skips an empty row (no write, row kept)", async () => {
    const d = deps();
    const out = await saveOtherExpenseRows(
      [{ _id: 1, name: "", amount: undefined }],
      [],
      d,
    );
    expect(d.post).not.toHaveBeenCalled();
    expect(out.rows[0].serverId).toBeUndefined();
  });

  it("PUTs a row with a serverId instead of POSTing", async () => {
    const d = deps();
    const rows: OtherExpenseRow[] = [
      { _id: 1, serverId: "x", name: "Vacation", amount: 10000 },
    ];
    await saveOtherExpenseRows(rows, [], d);
    expect(d.put).toHaveBeenCalledWith("x", expect.anything());
    expect(d.post).not.toHaveBeenCalled();
  });

  it("DELETEs ids in the deleted set", async () => {
    const d = deps();
    await saveOtherExpenseRows([], ["gone"], d);
    expect(d.del).toHaveBeenCalledWith("gone");
  });

  it("is idempotent: a second save of the returned rows POSTs nothing new and PUTs once", async () => {
    const d = deps();
    const first = await saveOtherExpenseRows(
      [{ _id: 1, name: "Travel", amount: 5000 }],
      [],
      d,
    );
    d.post.mockClear();
    await saveOtherExpenseRows(first.rows, [], d);
    expect(d.post).not.toHaveBeenCalled();
    expect(d.put).toHaveBeenCalledTimes(1);
  });
});
