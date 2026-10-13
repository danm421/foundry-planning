// src/lib/fact-finder/__tests__/screen-summary.test.ts
import { describe, expect, it } from "vitest";
import { applyOps, diffSnapshots, type ClientOp, type OpContext } from "../ops";
import { PAGE_ORDER } from "../schema";
import { changedCellsOf, lastChangeTurnId, pageCounts } from "../screen-summary";
import { countCellsToCheck, countLinksNeedingClick, emptyFactFinderState } from "../state";
import type { FactFinderState, FFCell, FFCellValue, FFChatTurn, FFRow } from "../types";

const AT = "2026-10-12T12:00:00.000Z";
const doc = (value: FFCellValue, confidence = 0.9, extra: Partial<FFCell> = {}): FFCell => ({
  value,
  confidence,
  by: "document",
  source: { fileId: "f1" },
  ...extra,
});
const row = (id: string, cells: Record<string, FFCell>, extra: Partial<FFRow> = {}): FFRow => ({
  id,
  cells,
  sourceFileIds: ["f1"],
  ...extra,
});
const suggested = (recordId: string): FFRow["link"] => ({ kind: "existing", recordId, score: 0.74, confirmed: false, by: "auto" });

describe("pageCounts", () => {
  it("counts each page's values to check and links needing a click, and they add up to the totals", () => {
    const s = emptyFactFinderState();
    const [client, coClient] = s.sections.people;
    const state: FactFinderState = {
      ...s,
      sections: {
        ...s.sections,
        people: [
          { ...client, cells: { firstName: doc("Mark", 0.95), retirementMonth: doc("Sept-ish", 0.9, { issue: "notAnOption" }) } },
          coClient,
        ],
        cash: [
          row("c1", { accountName: doc("Joint Checking", 0.5), currentValue: doc(12000, 0.95) }, { link: suggested("acct-1") }),
        ],
        taxable: [
          row("t1", { accountName: doc("Brokerage"), currentValue: doc(900, 0.4, { pinned: true }) }, {
            link: { kind: "existing", recordId: "acct-2", score: 0.95, confirmed: true, by: "auto" },
          }),
        ],
        liab: [row("l1", { loanName: doc("Mortgage", 0.6) }, { link: suggested("liab-1") })],
        life: [row("p1", { policyName: doc("Term 20") }, { link: suggested("pol-1") })],
        gifts: [row("g1", { recipient: doc("") })],
      },
      // The tray counts nowhere.
      removed: [
        {
          sectionId: "cash",
          row: row("c9", { accountName: doc("Rollup", 0.2) }, { link: suggested("acct-9") }),
          reason: "Rollup",
          by: "document",
          at: AT,
        },
      ],
    };

    const counts = pageCounts(state);
    expect(Object.keys(counts)).toEqual(PAGE_ORDER.map((p) => p.id));
    expect(counts).toEqual({
      household: { hasData: true, toCheck: 1, toLink: 0 },
      accounts: { hasData: true, toCheck: 1, toLink: 1 },
      realEstateDebts: { hasData: true, toCheck: 1, toLink: 1 },
      income: { hasData: false, toCheck: 0, toLink: 0 },
      expensesSavings: { hasData: false, toCheck: 0, toLink: 0 },
      insurance: { hasData: true, toCheck: 0, toLink: 1 },
      estate: { hasData: false, toCheck: 0, toLink: 0 },
    });
    const pages = Object.values(counts);
    expect(pages.reduce((n, p) => n + p.toCheck, 0)).toBe(countCellsToCheck(state));
    expect(pages.reduce((n, p) => n + p.toLink, 0)).toBe(countLinksNeedingClick(state));
    expect(countCellsToCheck(state)).toBe(3);
    expect(countLinksNeedingClick(state)).toBe(3);
  });

  it("marks Accounts as having data when only unassigned holdings are waiting", () => {
    expect(pageCounts(emptyFactFinderState()).accounts.hasData).toBe(false);
    const state: FactFinderState = {
      ...emptyFactFinderState(),
      unassignedHoldings: [
        { id: "u1", ticker: "AAPL", name: null, shares: 5, price: 100, marketValue: 500, costBasis: null, by: "document", accountHint: "x4410" },
      ],
    };
    expect(pageCounts(state).accounts).toEqual({ hasData: true, toCheck: 0, toLink: 0 });
  });
});

describe("lastChangeTurnId / changedCellsOf", () => {
  let n = 0;
  const chat: OpContext = { by: "chat", now: AT, newId: () => `added-${++n}` };

  /** A chat reply as the turn route stores it: its ops applied, its snapshots under its assistant turn id. */
  function reply(before: FactFinderState, turnId: string, ops: ClientOp[]): FactFinderState {
    const after = applyOps(before, ops, chat);
    return { ...after, undo: { ...after.undo, [turnId]: diffSnapshots(before, after) } };
  }

  const turns: FFChatTurn[] = [
    { id: "u0", role: "user", text: "Ally, not just Savings", at: AT },
    { id: "a0", role: "assistant", text: "Renamed it.", at: AT },
    { id: "u1", role: "user", text: "Checking is 12,500 and add the money market", at: AT },
    { id: "t1", role: "tool", tool: "set_cell", summary: "Joint Checking · Current value = 12,500", at: AT },
    { id: "a1", role: "assistant", text: "Done.", at: AT },
    // A read summary: an assistant turn with no undo entry.
    { id: "a2", role: "assistant", text: "Read 1 document.", at: AT },
  ];

  function afterTwoReplies(): FactFinderState {
    n = 0;
    const s = emptyFactFinderState();
    const start: FactFinderState = {
      ...s,
      sections: {
        ...s.sections,
        cash: [
          row("c1", { accountName: doc("Joint Checking"), currentValue: doc(12000) }),
          row("c2", { accountName: doc("Savings") }),
          row("c3", { accountName: doc("Old CD") }, { linkCandidates: [{ recordId: "acct-9", label: "Ally CD", score: 0.6 }] }),
        ],
      },
      removed: [{ sectionId: "cash", row: row("c4", { accountName: doc("Brokerage cash") }), reason: "Removed", by: "advisor", at: AT }],
    };
    const first = reply(start, "a0", [
      { op: "setCell", sectionId: "cash", rowId: "c2", columnId: "accountName", value: "Savings (Ally)" },
    ]);
    const second = reply(first, "a1", [
      { op: "setCell", sectionId: "cash", rowId: "c1", columnId: "currentValue", value: 12500 },
      { op: "removeRow", sectionId: "cash", rowId: "c2" },
      { op: "setLink", sectionId: "cash", rowId: "c3", link: { kind: "existing", recordId: "acct-9" } },
      { op: "addRow", sectionId: "cash", cells: { accountName: "Money market", currentValue: 8000 } },
      { op: "restoreRow", rowId: "c4" },
    ]);
    return { ...second, transcript: turns };
  }

  it("picks the latest reply that changed something, past a later read summary", () => {
    expect(lastChangeTurnId(afterTwoReplies())).toBe("a1");
  });

  it("lists the cells and links that reply changed, and every value of a row it added or restored", () => {
    expect([...changedCellsOf(afterTwoReplies())].sort()).toEqual([
      "added-1:accountName",
      "added-1:currentValue",
      "c1:currentValue",
      "c3:link",
      "c4:accountName",
    ]);
  });

  it("is empty when no reply has changed anything", () => {
    const state: FactFinderState = {
      ...emptyFactFinderState(),
      transcript: [{ id: "a2", role: "assistant", text: "Read 1 document.", at: AT }],
    };
    expect(lastChangeTurnId(state)).toBeNull();
    expect(changedCellsOf(state).size).toBe(0);
  });
});
