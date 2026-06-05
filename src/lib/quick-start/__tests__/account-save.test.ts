import { describe, it, expect, vi } from "vitest";
import { saveAccountRows, isEmptyAccount, type AccountRow } from "../account-save";
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

describe("isEmptyAccount", () => {
  it("value 0 is empty; non-zero value is not", () => {
    expect(isEmptyAccount({ kind: "cash", owner: "client", value: 0 })).toBe(true);
    expect(isEmptyAccount({ kind: "cash", owner: "client", value: 100 })).toBe(false);
  });
});

describe("saveAccountRows", () => {
  it("POSTs a new non-empty row and assigns its serverId", async () => {
    const d = deps();
    const rows: AccountRow[] = [{ _id: 1, kind: "cash", owner: "client", value: 5000 }];
    const out = await saveAccountRows(rows, [], d);
    expect(d.post).toHaveBeenCalledTimes(1);
    expect(out.rows[0].serverId).toBe("srv-1");
  });

  it("skips empty rows (value 0, no write, row kept)", async () => {
    const d = deps();
    const out = await saveAccountRows(
      [{ _id: 1, kind: "cash", owner: "client", value: 0 }],
      [],
      d,
    );
    expect(d.post).not.toHaveBeenCalled();
    expect(out.rows[0].serverId).toBeUndefined();
  });

  it("PUTs an existing row instead of POSTing", async () => {
    const d = deps();
    const rows: AccountRow[] = [
      { _id: 1, serverId: "x", kind: "taxable", owner: "client", value: 10000 },
    ];
    await saveAccountRows(rows, [], d);
    expect(d.put).toHaveBeenCalledWith("x", expect.anything());
    expect(d.post).not.toHaveBeenCalled();
  });

  it("DELETEs ids in the deleted set", async () => {
    const d = deps();
    await saveAccountRows([], ["gone"], d);
    expect(d.del).toHaveBeenCalledWith("gone");
  });

  it("is idempotent: a second save of the returned rows POSTs nothing new and PUTs once", async () => {
    const d = deps();
    const first = await saveAccountRows(
      [{ _id: 1, kind: "retirement", owner: "client", value: 50000 }],
      [],
      d,
    );
    d.post.mockClear();
    await saveAccountRows(first.rows, [], d);
    expect(d.post).not.toHaveBeenCalled();
    expect(d.put).toHaveBeenCalledTimes(1);
  });
});
