// src/lib/fact-finder/__tests__/client-ops.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { opTargets, rebaseOps, type OpTarget } from "../client-ops";
import { applyOps, type ClientOp, type OpContext } from "../ops";
import { emptyFactFinderState } from "../state";
import type { FactFinderState, FFCell, FFCellValue, FFHolding, FFRow } from "../types";

let n = 0;
const advisor: OpContext = { by: "advisor", now: "2026-10-12T12:00:00.000Z", newId: () => `new-${++n}` };
const chat: OpContext = { ...advisor, by: "chat" };
beforeEach(() => {
  n = 0;
});

const doc = (value: FFCellValue): FFCell => ({ value, confidence: 0.9, by: "document", source: { fileId: "f1" } });
const row = (id: string, cells: Record<string, FFCell>, extra: Partial<FFRow> = {}): FFRow => ({
  id,
  cells,
  sourceFileIds: ["f1"],
  ...extra,
});
const holding = (id: string, ticker: string, shares: number): FFHolding => ({
  id,
  ticker,
  name: null,
  shares,
  price: 100,
  marketValue: shares * 100,
  costBasis: null,
  by: "document",
});

/** The server state the advisor's pending edits were made against. */
function lastServer(): FactFinderState {
  const s = emptyFactFinderState();
  return {
    ...s,
    version: 4,
    sections: {
      ...s.sections,
      cash: [
        row("c1", { accountName: doc("Joint Checking"), currentValue: doc(12000) }, {
          link: { kind: "existing", recordId: "acct-1", score: 0.74, confirmed: false, by: "auto" },
          linkCandidates: [{ recordId: "acct-1", label: "Chase Checking", score: 0.74 }],
        }),
        row("c2", { accountName: doc("Savings"), currentValue: doc(5000) }),
      ],
      taxable: [
        row("t1", { accountName: doc("Joint Brokerage") }, { holdings: [holding("h1", "VTI", 10), holding("h2", "BND", 20)] }),
        row("t2", { accountName: doc("Individual Brokerage") }),
      ],
    },
    unassignedHoldings: [{ ...holding("u1", "AAPL", 5), accountHint: "x4410" }],
  };
}

/** What a reading does to a row: fills a document cell and leaves its link alone. */
function readingFills(state: FactFinderState, sectionId: string, rowId: string, columnId: string, cell: FFCell): FactFinderState {
  const rows = state.sections[sectionId].map((r) => (r.id === rowId ? { ...r, cells: { ...r.cells, [columnId]: cell } } : r));
  return { ...state, version: state.version + 1, sections: { ...state.sections, [sectionId]: rows } };
}

describe("opTargets", () => {
  it("names what each edit depends on", () => {
    const cases: Array<[ClientOp, OpTarget[]]> = [
      [
        { op: "setCell", sectionId: "cash", rowId: "c1", columnId: "currentValue", value: 1 },
        [{ kind: "cell", rowId: "c1", columnId: "currentValue" }],
      ],
      [
        { op: "clearCell", sectionId: "cash", rowId: "c1", columnId: "last4" },
        [{ kind: "cell", rowId: "c1", columnId: "last4" }],
      ],
      [{ op: "addRow", sectionId: "cash" }, []],
      [{ op: "addRow", sectionId: "cash", rowId: "mine-1" }, [{ kind: "place", rowId: "mine-1" }]],
      [{ op: "removeRow", sectionId: "cash", rowId: "c1" }, [{ kind: "place", rowId: "c1" }]],
      [{ op: "restoreRow", rowId: "c1" }, [{ kind: "place", rowId: "c1" }]],
      [
        { op: "mergeRows", sectionId: "cash", keepRowId: "c1", dropRowId: "c2" },
        [{ kind: "place", rowId: "c1" }, { kind: "place", rowId: "c2" }],
      ],
      [{ op: "setLink", sectionId: "cash", rowId: "c1", link: { kind: "new" } }, [{ kind: "link", rowId: "c1" }]],
      [
        { op: "setHolding", sectionId: "taxable", rowId: "t1", holdingId: "h1", field: "shares", value: 11 },
        [{ kind: "holding", rowId: "t1", holdingId: "h1" }],
      ],
      [
        { op: "removeHolding", sectionId: "taxable", rowId: "t1", holdingId: "h2" },
        [{ kind: "holding", rowId: "t1", holdingId: "h2" }],
      ],
      [
        { op: "assignHolding", holdingId: "u1", from: "unassigned", to: { sectionId: "taxable", rowId: "t1" } },
        [{ kind: "holding", rowId: null, holdingId: "u1" }, { kind: "destination", rowId: "t1" }],
      ],
      [
        {
          op: "assignHolding",
          holdingId: "h1",
          from: { sectionId: "taxable", rowId: "t1" },
          to: { sectionId: "taxable", rowId: "t2" },
        },
        [{ kind: "holding", rowId: "t1", holdingId: "h1" }, { kind: "destination", rowId: "t2" }],
      ],
    ];
    for (const [op, targets] of cases) expect(opTargets(op)).toEqual(targets);
  });
});

describe("rebaseOps", () => {
  it("drops an edit to a cell that changed on the server and keeps one to another cell of the same row", () => {
    const last = lastServer();
    const fresh = applyOps(last, [
      { op: "setCell", sectionId: "cash", rowId: "c1", columnId: "currentValue", value: 12500 },
    ], chat);
    const mine: ClientOp[] = [
      { op: "setCell", sectionId: "cash", rowId: "c1", columnId: "currentValue", value: "13,000" },
      { op: "setCell", sectionId: "cash", rowId: "c1", columnId: "last4", value: "0042" },
    ];
    expect(rebaseOps(mine, last, fresh, advisor)).toEqual({ kept: [mine[1]], dropped: [mine[0]] });
  });

  it("keeps a remove when a reading only filled a cell of that row, drops it when the row was already removed", () => {
    const last = lastServer();
    const remove: ClientOp = { op: "removeRow", sectionId: "cash", rowId: "c1", reason: "Closed" };
    const filled = readingFills(last, "cash", "c1", "last4", doc("0042"));
    expect(rebaseOps([remove], last, filled, advisor)).toEqual({ kept: [remove], dropped: [] });
    expect(applyOps(filled, [remove], advisor).removed.map((e) => e.row.id)).toEqual(["c1"]);

    const removedByChat = applyOps(last, [{ op: "removeRow", sectionId: "cash", rowId: "c1" }], chat);
    expect(rebaseOps([remove], last, removedByChat, advisor)).toEqual({ kept: [], dropped: [remove] });
  });

  it("drops a link choice when the row's link changed, keeps it when only its cells did", () => {
    const last = lastServer();
    const pickNew: ClientOp = { op: "setLink", sectionId: "cash", rowId: "c1", link: { kind: "new" } };
    const confirmed = applyOps(last, [
      { op: "setLink", sectionId: "cash", rowId: "c1", link: { kind: "existing", recordId: "acct-1" } },
    ], chat);
    expect(rebaseOps([pickNew], last, confirmed, advisor)).toEqual({ kept: [], dropped: [pickNew] });

    const filled = readingFills(last, "cash", "c1", "last4", doc("0042"));
    expect(rebaseOps([pickNew], last, filled, advisor)).toEqual({ kept: [pickNew], dropped: [] });
  });

  it("drops an edit to a holding that changed, keeps one to another holding of the same account", () => {
    const last = lastServer();
    const fresh = applyOps(last, [
      { op: "setHolding", sectionId: "taxable", rowId: "t1", holdingId: "h1", field: "shares", value: 12 },
    ], chat);
    const mine: ClientOp[] = [
      { op: "setHolding", sectionId: "taxable", rowId: "t1", holdingId: "h1", field: "price", value: "101" },
      { op: "removeHolding", sectionId: "taxable", rowId: "t1", holdingId: "h2" },
    ];
    expect(rebaseOps(mine, last, fresh, advisor)).toEqual({ kept: [mine[1]], dropped: [mine[0]] });
  });

  it("drops a move of an unassigned holding the server already placed, or to an account it removed", () => {
    const last = lastServer();
    const toT1: ClientOp = { op: "assignHolding", holdingId: "u1", from: "unassigned", to: { sectionId: "taxable", rowId: "t1" } };
    const toT2: ClientOp = { op: "assignHolding", holdingId: "u1", from: "unassigned", to: { sectionId: "taxable", rowId: "t2" } };

    const placed = applyOps(last, [toT1], chat);
    expect(rebaseOps([toT2], last, placed, advisor)).toEqual({ kept: [], dropped: [toT2] });

    const t2Removed = applyOps(last, [{ op: "removeRow", sectionId: "taxable", rowId: "t2" }], chat);
    expect(rebaseOps([toT2], last, t2Removed, advisor)).toEqual({ kept: [], dropped: [toT2] });
    expect(rebaseOps([toT1], last, t2Removed, advisor)).toEqual({ kept: [toT1], dropped: [] });
  });

  it("keeps an added row and the edits on it, in their order, around a dropped edit", () => {
    const last = lastServer();
    const fresh = applyOps(last, [
      { op: "setCell", sectionId: "cash", rowId: "c2", columnId: "currentValue", value: 5200 },
      { op: "addRow", sectionId: "cash", cells: { accountName: "CD" } },
    ], chat);
    const mine: ClientOp[] = [
      { op: "setCell", sectionId: "cash", rowId: "c1", columnId: "accountName", value: "Joint Checking (Chase)" },
      { op: "setCell", sectionId: "cash", rowId: "c2", columnId: "currentValue", value: 5100 },
      { op: "addRow", sectionId: "cash", rowId: "mine-1", cells: { accountName: "Money market" } },
      { op: "setCell", sectionId: "cash", rowId: "mine-1", columnId: "currentValue", value: "8,000" },
      { op: "setLink", sectionId: "cash", rowId: "mine-1", link: { kind: "new" } },
      { op: "setCell", sectionId: "cash", rowId: "c1", columnId: "last4", value: "0042" },
    ];
    const { kept, dropped } = rebaseOps(mine, last, fresh, advisor);
    expect(kept).toEqual([mine[0], mine[2], mine[3], mine[4], mine[5]]);
    expect(dropped).toEqual([mine[1]]);
    const next = applyOps(fresh, kept, advisor);
    expect(next.sections.cash.map((r) => r.id)).toEqual(["c1", "c2", "new-1", "mine-1"]);
    expect(next.sections.cash[3].cells.currentValue.value).toBe(8000);
  });

  it("drops an edit to a row whose add was dropped — it no longer applies", () => {
    const last = lastServer();
    // The server already added mine-1 (its reply was lost), then a chat reply removed it.
    const added = applyOps(last, [{ op: "addRow", sectionId: "cash", rowId: "mine-1" }], advisor);
    const fresh = applyOps(added, [{ op: "removeRow", sectionId: "cash", rowId: "mine-1" }], chat);
    const mine: ClientOp[] = [
      { op: "addRow", sectionId: "cash", rowId: "mine-1" },
      { op: "setCell", sectionId: "cash", rowId: "mine-1", columnId: "accountName", value: "Money market" },
    ];
    expect(rebaseOps(mine, last, fresh, advisor)).toEqual({ kept: [], dropped: mine });
  });
});
