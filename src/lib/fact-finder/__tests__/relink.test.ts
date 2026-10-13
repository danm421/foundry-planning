// src/lib/fact-finder/__tests__/relink.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../records/load", () => ({ resolveBaseCaseScenarioId: vi.fn(), loadExistingRecords: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));

import { loadBaseCaseRecords, opsNeedRelink, relinkBaseCase } from "../relink";
import { loadExistingRecords, resolveBaseCaseScenarioId } from "../records/load";
import { emptyExistingRecords, type ExistingRecords } from "../records/types";
import type { FFOp } from "../ops";
import { emptyFactFinderState } from "../state";
import type { FactFinderState } from "../types";

function baseCase(): ExistingRecords {
  const r = emptyExistingRecords();
  r.candidates.accounts = [
    { id: "acct-b", name: "Schwab Brokerage", category: "taxable", accountNumberLast4: "7731", custodian: "Schwab", value: 250000 },
  ];
  return r;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveBaseCaseScenarioId).mockResolvedValue("s1");
  vi.mocked(loadExistingRecords).mockResolvedValue(baseCase());
});

describe("loadBaseCaseRecords", () => {
  it("loads the records of the client's base case", async () => {
    expect(await loadBaseCaseRecords("c1")).toEqual(baseCase());
    expect(resolveBaseCaseScenarioId).toHaveBeenCalledWith("c1");
    expect(loadExistingRecords).toHaveBeenCalledWith("c1", "s1");
  });

  it("has nothing to link to when the client has no base case", async () => {
    vi.mocked(resolveBaseCaseScenarioId).mockResolvedValueOnce(null);
    expect(await loadBaseCaseRecords("c1")).toEqual(emptyExistingRecords());
    expect(loadExistingRecords).not.toHaveBeenCalled();
  });
});

describe("relinkBaseCase", () => {
  it("scores the rows against the base case's records", async () => {
    const s = emptyFactFinderState();
    const typed = (value: string) => ({ value, by: "advisor" as const, pinned: true as const });
    const state: FactFinderState = {
      ...s,
      sections: {
        ...s.sections,
        taxable: [{ id: "t1", cells: { accountName: typed("Schwab Brokerage"), last4: typed("7731") }, sourceFileIds: [] }],
      },
    };
    const next = await relinkBaseCase(state, "c1");
    expect(next.sections.taxable[0].link).toEqual({ kind: "existing", recordId: "acct-b", score: 1, confirmed: true, by: "auto" });
    expect(loadExistingRecords).toHaveBeenCalledWith("c1", "s1");
  });
});

describe("opsNeedRelink", () => {
  const holdingOps: FFOp[] = [
    { op: "setHolding", sectionId: "taxable", rowId: "t1", holdingId: "h1", field: "shares", value: 3 },
    { op: "removeHolding", sectionId: "taxable", rowId: "t1", holdingId: "h1" },
    { op: "assignHolding", holdingId: "h2", from: "unassigned", to: { sectionId: "taxable", rowId: "t1" } },
  ];

  it("is false for holdings and for sections that don't link", () => {
    expect(opsNeedRelink(holdingOps)).toBe(false);
    expect(
      opsNeedRelink([...holdingOps, { op: "setCell", sectionId: "living_items", rowId: "i1", columnId: "item", value: "Groceries" }]),
    ).toBe(false);
  });

  it("is true once any op edits, adds, removes, merges or links a row of a section that links", () => {
    const linking: FFOp[] = [
      { op: "setCell", sectionId: "cash", rowId: "c1", columnId: "accountName", value: "Checking" },
      { op: "clearCell", sectionId: "cash", rowId: "c1", columnId: "last4" },
      { op: "addRow", sectionId: "liab", rowId: "l1" },
      { op: "removeRow", sectionId: "taxable", rowId: "t1" },
      { op: "mergeRows", sectionId: "taxable", keepRowId: "t1", dropRowId: "t2" },
      { op: "setLink", sectionId: "taxable", rowId: "t1", link: { kind: "new" } },
      { op: "setCell", sectionId: "salary", rowId: "salary:Client", columnId: "employer", value: "Acme" },
    ];
    for (const op of linking) expect(opsNeedRelink([...holdingOps, op])).toBe(true);
  });

  it("is true for a restore, whose op doesn't name the row's section", () => {
    expect(opsNeedRelink([{ op: "restoreRow", rowId: "r1" }])).toBe(true);
    expect(opsNeedRelink([{ op: "restoreSnapshots", snapshots: [] }])).toBe(true);
  });
});
