import { describe, it, expect, vi } from "vitest";
import {
  saveLiabilityRows,
  isEmptyLiability,
  type LiabilityRow,
} from "../liability-save";
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

describe("isEmptyLiability", () => {
  it("name empty and balance undefined is empty", () => {
    expect(isEmptyLiability({ _id: 1, name: "", balance: undefined })).toBe(true);
  });
  it("name filled is not empty", () => {
    expect(isEmptyLiability({ _id: 1, name: "Mortgage" })).toBe(false);
  });
  it("balance filled (name empty) is not empty", () => {
    expect(isEmptyLiability({ _id: 1, name: "", balance: 300000 })).toBe(false);
  });
});

describe("saveLiabilityRows", () => {
  it("POSTs a new non-empty row, assigns serverId, converts pct→fraction, amortizes payment", async () => {
    const d = deps();
    const rows: LiabilityRow[] = [
      { _id: 1, name: "Mortgage", balance: 300000, interestRatePct: 6, termYears: 30 },
    ];
    const out = await saveLiabilityRows(rows, [], d);
    expect(d.post).toHaveBeenCalledTimes(1);
    expect(out.rows[0].serverId).toBe("srv-1");

    const body = d.post.mock.calls[0][0] as {
      termMonths: number;
      interestRate: number;
      monthlyPayment: unknown;
    };
    expect(body.termMonths).toBe(360);
    expect(body.interestRate).toBe(0.06);
    expect(Math.round(Number(body.monthlyPayment))).toBe(1799);
  });

  it("skips an empty row (no write, row kept)", async () => {
    const d = deps();
    const out = await saveLiabilityRows(
      [{ _id: 1, name: "", balance: undefined }],
      [],
      d,
    );
    expect(d.post).not.toHaveBeenCalled();
    expect(out.rows[0].serverId).toBeUndefined();
  });

  it("PUTs a row with a serverId instead of POSTing", async () => {
    const d = deps();
    const rows: LiabilityRow[] = [
      { _id: 1, serverId: "x", name: "Auto Loan", balance: 15000, interestRatePct: 5, termYears: 5 },
    ];
    await saveLiabilityRows(rows, [], d);
    expect(d.put).toHaveBeenCalledWith("x", expect.anything());
    expect(d.post).not.toHaveBeenCalled();
  });

  it("DELETEs ids in the deleted set", async () => {
    const d = deps();
    await saveLiabilityRows([], ["gone"], d);
    expect(d.del).toHaveBeenCalledWith("gone");
  });

  it("is idempotent: a second save of the returned rows POSTs nothing new and PUTs once", async () => {
    const d = deps();
    const first = await saveLiabilityRows(
      [{ _id: 1, name: "Mortgage", balance: 300000, interestRatePct: 6, termYears: 30 }],
      [],
      d,
    );
    d.post.mockClear();
    await saveLiabilityRows(first.rows, [], d);
    expect(d.post).not.toHaveBeenCalled();
    expect(d.put).toHaveBeenCalledTimes(1);
  });
});
