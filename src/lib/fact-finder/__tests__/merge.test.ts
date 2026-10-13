// src/lib/fact-finder/__tests__/merge.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { mergeReadings, type MergeContext } from "../merge";
import { applyOps } from "../ops";
import { emptyFactFinderState } from "../state";
import type { FactFinderState, FFReadCell, FFReading, FFUnassignedReading } from "../types";

let n = 0;
const ctx: MergeContext = { now: "2026-10-12T12:00:00.000Z", newId: () => `id-${++n}` };
beforeEach(() => {
  n = 0;
});

const cell = (value: FFReadCell["value"], confidence = 0.9, fileId = "f1"): FFReadCell => ({
  value,
  confidence,
  source: { fileId },
});
const fidelity = (overrides: Partial<FFReading> = {}, values: Record<string, FFReadCell> = {}): FFReading => ({
  sectionId: "retirement",
  fileId: "f1",
  statementDate: "2026-06-30",
  cells: {
    accountName: cell("Fidelity 401(k)"),
    currentValue: cell(600000),
    last4: cell("2201"),
    custodian: cell("Fidelity"),
    ...values,
  },
  ...overrides,
});
const advisor = { by: "advisor" as const, now: ctx.now, newId: () => "never" };

describe("mergeReadings — new and repeated readings", () => {
  it("adds a row from a new reading", () => {
    const { state, decisions } = mergeReadings(emptyFactFinderState(), [fidelity()], ctx);
    const [row] = state.sections.retirement;
    expect(row.id).toBe("id-1");
    expect(row.cells.currentValue).toEqual({ value: 600000, confidence: 0.9, source: { fileId: "f1" }, by: "document" });
    expect(row.identity).toEqual({ accountName: "Fidelity 401(k)", currentValue: 600000, last4: "2201", custodian: "Fidelity" });
    expect(row.sourceFileIds).toEqual(["f1"]);
    expect(row.statementDate).toBe("2026-06-30");
    expect(decisions).toEqual([{ kind: "added", sectionId: "retirement", rowId: "id-1", label: "Fidelity 401(k)", fileId: "f1" }]);
  });

  it("changes nothing when the same reading arrives again", () => {
    const once = mergeReadings(emptyFactFinderState(), [fidelity()], ctx).state;
    const twice = mergeReadings(once, [fidelity()], ctx);
    expect(twice.state).toBe(once);
    expect(twice.decisions).toEqual([]);
  });

  it("merges a fixed-row reading into its fixed row", () => {
    const { state } = mergeReadings(emptyFactFinderState(), [
      { sectionId: "people", fixedRow: "Co-client", fileId: "f1", cells: { firstName: cell("Laura", 1) } },
    ], ctx);
    expect(state.sections.people[1].id).toBe("people:Co-client");
    expect(state.sections.people[1].cells.firstName.value).toBe("Laura");
  });

  it("keeps every row one document lists, even rows that look alike, and re-reading it changes nothing", () => {
    const read = (sectionId: string, values: Record<string, FFReadCell["value"]>): FFReading => ({
      sectionId,
      fileId: "ff",
      cells: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, cell(v, 1, "ff")])),
    });
    const readings = [
      read("cash", { accountName: "Checking", currentValue: 12000, custodian: "Chase" }),
      read("cash", { accountName: "Checking", currentValue: 45000, owner: "Joint", custodian: "Credit Union" }),
      read("bequests", { willOf: "Client", gift: "Remaining estate", recipients: "Laura Hendricks 100%", condition: "If co-client survives" }),
      read("bequests", { willOf: "Client", gift: "Remaining estate", recipients: "Children equally", condition: "If co-client predeceases" }),
      read("liab", { loanName: "Car loan", balance: 12000 }),
      read("liab", { loanName: "Car loan", balance: 9000 }),
    ];
    const first = mergeReadings(emptyFactFinderState(), readings, ctx);
    expect(first.state.sections.cash.map((r) => r.cells.currentValue.value)).toEqual([12000, 45000]);
    expect(first.state.sections.bequests.map((r) => r.cells.recipients.value)).toEqual(["Laura Hendricks 100%", "Children equally"]);
    expect(first.state.sections.liab.map((r) => r.cells.balance.value)).toEqual([12000, 9000]);
    expect(mergeReadings(first.state, readings, ctx).state).toBe(first.state);
  });
});

describe("mergeReadings — accounts with the same name", () => {
  it("keeps same-named accounts with different owners apart", () => {
    const roth = (owner: string, value: number): FFReading => ({
      sectionId: "retirement",
      fileId: "ff",
      cells: { accountName: cell("Roth IRA", 0.9, "ff"), owner: cell(owner, 0.9, "ff"), currentValue: cell(value, 0.9, "ff") },
    });
    const { state, decisions } = mergeReadings(emptyFactFinderState(), [roth("Client", 50000), roth("Co-client", 80000)], ctx);
    expect(state.sections.retirement.map((r) => r.cells.owner.value)).toEqual(["Client", "Co-client"]);
    expect(decisions.map((d) => d.kind)).toEqual(["added", "added"]);
  });

  it("keeps two same-named statements at different banks apart when neither prints a last 4", () => {
    const checking = (fileId: string, custodian: string, value: number) =>
      fidelity({ sectionId: "cash", fileId }, {
        accountName: cell("Checking", 0.9, fileId), custodian: cell(custodian, 0.9, fileId), currentValue: cell(value, 0.9, fileId), last4: cell(null),
      });
    const readings = [checking("s1", "Chase", 12000), checking("s2", "Wells Fargo", 8000)];
    const { state } = mergeReadings(emptyFactFinderState(), readings, ctx);
    expect(state.sections.cash.map((r) => r.cells.currentValue.value)).toEqual([12000, 8000]);
    expect(mergeReadings(state, readings, ctx).state).toBe(state);
  });

  it("keeps a different account out of a row once the advisor types its last 4", () => {
    const ff: FFReading = { sectionId: "retirement", fileId: "ff", cells: { accountName: cell("Fidelity 401(k)", 0.9, "ff") } };
    const typed = applyOps(mergeReadings(emptyFactFinderState(), [ff], ctx).state, [
      { op: "setCell", sectionId: "retirement", rowId: "id-1", columnId: "last4", value: "1111" },
    ], advisor);
    const other = mergeReadings(typed, [fidelity({ fileId: "s1" }, { last4: cell("2222", 0.9, "s1") })], ctx).state;
    expect(other.sections.retirement.map((r) => r.cells.last4.value)).toEqual(["1111", "2222"]);
    const same = mergeReadings(typed, [fidelity({ fileId: "s1" }, { last4: cell("1111", 0.9, "s1") })], ctx).state;
    expect(same.sections.retirement).toHaveLength(1);
    expect(same.sections.retirement[0].cells.currentValue.value).toBe(600000);
  });

  it("learns the last 4 a statement fills in, so a second account of that name gets its own row", () => {
    const ff: FFReading = { sectionId: "retirement", fileId: "ff", cells: { accountName: cell("Fidelity 401(k)", 0.9, "ff") } };
    const statement = (fileId: string, last4: string, owner: string, value: number) =>
      fidelity({ fileId }, { last4: cell(last4, 0.9, fileId), owner: cell(owner, 0.9, fileId), currentValue: cell(value, 0.9, fileId) });
    const readings = [ff, statement("s1", "2201", "Client", 600000), statement("s2", "3301", "Co-client", 250000)];
    const first = mergeReadings(emptyFactFinderState(), readings, ctx);
    expect(first.state.sections.retirement.map((r) => r.sourceFileIds)).toEqual([["ff", "s1"], ["s2"]]);
    expect(first.decisions.map((d) => d.kind)).toEqual(["added", "updated", "added"]);
    expect(mergeReadings(first.state, readings, ctx).state).toBe(first.state);
  });
});

describe("mergeReadings — precedence", () => {
  const base = () => mergeReadings(emptyFactFinderState(), [fidelity()], ctx).state;

  it("never changes a pinned cell", () => {
    const pinned = applyOps(base(), [
      { op: "setCell", sectionId: "retirement", rowId: "id-1", columnId: "currentValue", value: 650000 },
    ], advisor);
    const reading = fidelity({ statementDate: "2026-09-30" }, { currentValue: cell(640000) });
    const { state } = mergeReadings(pinned, [reading], ctx);
    expect(state.sections.retirement[0].cells.currentValue).toEqual({ value: 650000, by: "advisor", pinned: true });
    expect(mergeReadings(state, [reading], ctx).state).toBe(state);
  });

  it("lets a newer statement replace values and an older one only fill blanks", () => {
    const newer = mergeReadings(base(), [fidelity({ statementDate: "2026-09-30" }, { currentValue: cell(640000) })], ctx).state;
    expect(newer.sections.retirement[0].cells.currentValue.value).toBe(640000);
    expect(newer.sections.retirement[0].statementDate).toBe("2026-09-30");
    const older = mergeReadings(newer, [
      fidelity({ statementDate: "2026-03-31" }, { currentValue: cell(590000), afterTaxBasis: cell(1200) }),
    ], ctx).state;
    expect(older.sections.retirement[0].cells.currentValue.value).toBe(640000);
    expect(older.sections.retirement[0].cells.afterTaxBasis.value).toBe(1200);
  });

  it("keeps a statement's value over an undated reading, whichever was read first", () => {
    const statement = fidelity({ fileId: "s1" }, { currentValue: cell(655123.45, 0.9, "s1") });
    const form = fidelity({ fileId: "ff", statementDate: undefined }, { currentValue: cell(640000, 1, "ff") });
    const value = (readings: FFReading[]) =>
      mergeReadings(emptyFactFinderState(), readings, ctx).state.sections.retirement[0].cells.currentValue.value;
    expect(value([statement, form])).toBe(655123.45);
    expect(value([form, statement])).toBe(655123.45);
  });

  it("uses confidence when neither reading is newer", () => {
    const low = mergeReadings(base(), [fidelity({ statementDate: "2026-06-30" }, { currentValue: cell(1, 0.4) })], ctx).state;
    expect(low.sections.retirement[0].cells.currentValue.value).toBe(600000);
    const high = mergeReadings(base(), [fidelity({ statementDate: "2026-06-30" }, { currentValue: cell(2, 0.95) })], ctx).state;
    expect(high.sections.retirement[0].cells.currentValue.value).toBe(2);
  });

  it("still finds the row after the advisor edits its last 4", () => {
    const edited = applyOps(base(), [
      { op: "setCell", sectionId: "retirement", rowId: "id-1", columnId: "last4", value: "2202" },
    ], advisor);
    const { state } = mergeReadings(edited, [fidelity({ statementDate: "2026-09-30" })], ctx);
    expect(state.sections.retirement).toHaveLength(1);
  });
});

describe("mergeReadings — removed and excluded rows", () => {
  it("keeps a removed row removed, counting each new file once", () => {
    const removed = applyOps(mergeReadings(emptyFactFinderState(), [fidelity()], ctx).state, [
      { op: "removeRow", sectionId: "retirement", rowId: "id-1", reason: "Rolled over" },
    ], advisor);
    const again = mergeReadings(removed, [fidelity({ fileId: "f2", statementDate: "2026-09-30" })], ctx);
    expect(again.state.sections.retirement).toEqual([]);
    expect(again.state.removed[0].absorbed).toBe(1);
    expect(again.decisions[0]).toMatchObject({ kind: "keptRemoved", rowId: "id-1" });
    const third = mergeReadings(again.state, [fidelity({ fileId: "f2", statementDate: "2026-09-30" })], ctx);
    expect(third.state).toBe(again.state);
  });

  it("sends a reading of a merged-away row into the row it was merged into", () => {
    let s = mergeReadings(emptyFactFinderState(), [
      fidelity(),
      fidelity({ fileId: "f2" }, { accountName: cell("401k x2299", 0.9, "f2"), last4: cell("2299", 0.9, "f2") }),
    ], ctx).state;
    s = applyOps(s, [{ op: "mergeRows", sectionId: "retirement", keepRowId: "id-1", dropRowId: "id-2" }], advisor);
    const reading = fidelity({ fileId: "f3", statementDate: "2026-09-30" }, {
      accountName: cell("401k x2299", 0.9, "f3"),
      last4: cell("2299", 0.9, "f3"),
      currentValue: cell(611000, 0.9, "f3"),
    });
    const { state } = mergeReadings(s, [reading], ctx);
    expect(state.sections.retirement.map((r) => r.id)).toEqual(["id-1"]);
    expect(state.sections.retirement[0].cells.currentValue.value).toBe(611000);
    expect(mergeReadings(state, [reading], ctx).state).toBe(state);
  });

  it("re-reading a document whose two look-alike rows the advisor merged adds nothing back", () => {
    const loan = (balance: number): FFReading => ({
      sectionId: "liab",
      fileId: "ff",
      cells: { loanName: cell("Car loan", 0.9, "ff"), balance: cell(balance, 0.9, "ff") },
    });
    const readings = [loan(12000), loan(9000)];
    const read = mergeReadings(emptyFactFinderState(), readings, ctx).state;
    const [a, b] = read.sections.liab;
    for (const [keepRowId, dropRowId] of [[a.id, b.id], [b.id, a.id]]) {
      const merged = applyOps(read, [{ op: "mergeRows", sectionId: "liab", keepRowId, dropRowId }], advisor);
      const again = mergeReadings(merged, readings, ctx);
      expect(again.state).toBe(merged);
      expect(again.decisions).toEqual([]);
    }
  });

  it("puts an excluded reading straight in the tray, once", () => {
    const rollup = fidelity({ exclude: { reason: "Total of the accounts above" } }, {
      accountName: cell("Total retirement"),
      last4: cell(null),
    });
    const first = mergeReadings(emptyFactFinderState(), [rollup], ctx);
    expect(first.state.sections.retirement).toEqual([]);
    expect(first.state.removed[0]).toMatchObject({ reason: "Total of the accounts above", by: "document" });
    expect(first.decisions[0]).toMatchObject({ kind: "excluded" });
    expect(mergeReadings(first.state, [rollup], ctx).state).toBe(first.state);
  });

  it("merges an excluded reading normally once the advisor has restored that row", () => {
    const rollup = fidelity({ exclude: { reason: "Total" } }, { accountName: cell("Total retirement"), last4: cell(null) });
    const first = mergeReadings(emptyFactFinderState(), [rollup], ctx).state;
    const restored = applyOps(first, [{ op: "restoreRow", rowId: "id-1" }], advisor);
    const { state } = mergeReadings(restored, [
      { ...rollup, statementDate: "2026-09-30", cells: { ...rollup.cells, currentValue: cell(700000) } },
    ], ctx);
    expect(state.sections.retirement).toHaveLength(1);
    expect(state.sections.retirement[0].cells.currentValue.value).toBe(700000);
  });
});

describe("mergeReadings — look-alike rows from one document, after the advisor edits them", () => {
  // Two "Auto Loan · Ally" with no property: only their other values tell them apart.
  const loan = (values: Record<string, FFReadCell["value"]>, confidence = 0.9, fileId = "ff"): FFReading => ({
    sectionId: "liab",
    fileId,
    cells: Object.fromEntries(
      Object.entries({ loanName: "Auto Loan · Ally", ...values }).map(([k, v]) => [k, cell(v, confidence, fileId)]),
    ),
  });
  const twoLoans = (fileId = "ff") => [loan({ balance: 12000, interestRate: 5.9 }, 0.9, fileId), loan({ balance: 9000 }, 0.9, fileId)];
  const removeFirst = (state: FactFinderState) =>
    applyOps(state, [{ op: "removeRow", sectionId: "liab", rowId: "id-1", reason: "Paid off" }], advisor);

  it("leaves the live row's own values alone on a re-read after the advisor removes the first look-alike", () => {
    const removed = removeFirst(mergeReadings(emptyFactFinderState(), twoLoans(), ctx).state);
    const again = mergeReadings(removed, twoLoans(), ctx);
    expect(again.state.sections.liab[0].cells.balance.value).toBe(9000);
    expect(again.state.sections.liab[0].cells.interestRate).toBeUndefined();
    expect(again.state).toBe(removed);
    expect(again.decisions).toEqual([]);
  });

  it("keeps the live row's own balance when the removed look-alike's balance was read with more confidence", () => {
    const readings = [loan({ balance: 12000 }, 0.95), loan({ balance: 9000 }, 0.8)];
    const removed = removeFirst(mergeReadings(emptyFactFinderState(), readings, ctx).state);
    const again = mergeReadings(removed, readings, ctx);
    expect(again.state.sections.liab.map((r) => r.cells.balance.value)).toEqual([9000]);
    expect(again.state).toBe(removed);
  });

  it("changes nothing on a re-read after the advisor removes and restores a look-alike, now listed after its sibling", () => {
    const restored = applyOps(mergeReadings(emptyFactFinderState(), twoLoans(), ctx).state, [
      { op: "removeRow", sectionId: "liab", rowId: "id-1" },
      { op: "restoreRow", rowId: "id-1" },
    ], advisor);
    expect(restored.sections.liab.map((r) => r.id)).toEqual(["id-2", "id-1"]);
    const again = mergeReadings(restored, twoLoans(), ctx);
    expect(again.state).toBe(restored);
    expect(again.decisions).toEqual([]);
  });

  // The restored look-alike's values are a subset of its sibling's, so the sibling holds every value of its reading too.
  it.each([
    ["a bare name, then the same name with a balance", [loan({}), loan({ balance: 12000 })]],
    ["a balance, then the same balance with an interest rate", [loan({ balance: 9000 }), loan({ balance: 9000, interestRate: 5.9 })]],
  ])("changes nothing on a re-read after the advisor removes and restores a look-alike whose values its sibling also has: %s", (_, readings) => {
    const restored = applyOps(mergeReadings(emptyFactFinderState(), readings, ctx).state, [
      { op: "removeRow", sectionId: "liab", rowId: "id-1" },
      { op: "restoreRow", rowId: "id-1" },
    ], advisor);
    expect(restored.sections.liab.map((r) => r.id)).toEqual(["id-2", "id-1"]);
    const again = mergeReadings(restored, readings, ctx);
    expect(again.decisions).toEqual([]);
    expect(again.state).toBe(restored);
  });

  it("changes nothing on a re-read after the advisor merges two of three look-alikes, whichever two", () => {
    const readings = [
      loan({ balance: 12000, interestRate: 5.9 }),
      loan({ balance: 9000, monthlyPI: 310 }),
      loan({ balance: 5000, termYears: 5 }),
    ];
    const read = mergeReadings(emptyFactFinderState(), readings, ctx).state;
    const ids = read.sections.liab.map((r) => r.id);
    for (const keepRowId of ids) {
      for (const dropRowId of ids.filter((id) => id !== keepRowId)) {
        const merged = applyOps(read, [{ op: "mergeRows", sectionId: "liab", keepRowId, dropRowId }], advisor);
        const again = mergeReadings(merged, readings, ctx);
        expect(again.state, `${dropRowId} merged into ${keepRowId}`).toBe(merged);
        expect(again.decisions).toEqual([]);
      }
    }
  });

  it("records a second copy of the document once — the removed look-alike absorbs its reading — and merging it again changes nothing", () => {
    const removed = removeFirst(mergeReadings(emptyFactFinderState(), twoLoans(), ctx).state);
    const copy = twoLoans("ff2");
    const once = mergeReadings(removed, copy, ctx);
    expect(once.state.sections.liab[0].cells).toEqual(removed.sections.liab[0].cells);
    expect(once.state.sections.liab[0].sourceFileIds).toEqual(["ff", "ff2"]);
    expect(once.state.removed[0]).toMatchObject({ absorbed: 1, row: { id: "id-1", sourceFileIds: ["ff", "ff2"] } });
    expect(once.decisions).toEqual([
      { kind: "keptRemoved", sectionId: "liab", rowId: "id-1", label: "Auto Loan · Ally", fileId: "ff2" },
    ]);
    const twice = mergeReadings(once.state, copy, ctx);
    expect(twice.state).toBe(once.state);
    expect(twice.decisions).toEqual([]);
  });
});

describe("mergeReadings — holdings", () => {
  const vti = { ticker: "VTI", name: "Vanguard Total", shares: 10, marketValue: 2500 };
  const bnd = { ticker: "BND", name: "Vanguard Bond", shares: 5, marketValue: 400 };
  const withHoldings = (statementDate: string, holdings: FFReading["holdings"]) =>
    fidelity({ sectionId: "taxable", statementDate, holdings });

  it("takes holdings from the first statement and replaces them from a newer one, keeping pinned holdings", () => {
    const first = mergeReadings(emptyFactFinderState(), [withHoldings("2026-06-30", [vti, bnd])], ctx).state;
    const row = first.sections.taxable[0];
    expect(row.holdings?.map((h) => h.ticker)).toEqual(["VTI", "BND"]);
    expect(row.holdingsAsOf).toBe("2026-06-30");
    const vtiId = row.holdings![0].id;
    const pinned = applyOps(first, [
      { op: "setHolding", sectionId: "taxable", rowId: row.id, holdingId: vtiId, field: "shares", value: 11 },
    ], advisor);
    const newer = mergeReadings(pinned, [withHoldings("2026-09-30", [{ ...vti, shares: 12 }, { ...bnd, shares: 6 }])], ctx).state;
    const holdings = newer.sections.taxable[0].holdings!;
    expect(holdings.find((h) => h.ticker === "VTI")?.shares).toBe(11);
    expect(holdings.find((h) => h.ticker === "BND")?.shares).toBe(6);
    expect(newer.sections.taxable[0].holdingsAsOf).toBe("2026-09-30");
  });

  it("never brings back a holding the advisor removed", () => {
    const first = mergeReadings(emptyFactFinderState(), [withHoldings("2026-06-30", [vti, bnd])], ctx).state;
    const row = first.sections.taxable[0];
    const removed = applyOps(first, [
      { op: "removeHolding", sectionId: "taxable", rowId: row.id, holdingId: row.holdings![1].id },
    ], advisor);
    const newer = mergeReadings(removed, [withHoldings("2026-09-30", [vti, bnd])], ctx).state;
    expect(newer.sections.taxable[0].holdings?.map((h) => h.ticker)).toEqual(["VTI"]);
  });

  it("never puts a holding the advisor moved to another account back on the first one", () => {
    const first = mergeReadings(emptyFactFinderState(), [
      withHoldings("2026-06-30", [vti]),
      fidelity({ sectionId: "taxable", fileId: "f2" }, { accountName: cell("Trust Brokerage", 0.9, "f2"), last4: cell("8842", 0.9, "f2") }),
    ], ctx).state;
    const [a, b] = first.sections.taxable;
    const moved = applyOps(first, [
      { op: "assignHolding", holdingId: a.holdings![0].id, from: { sectionId: "taxable", rowId: a.id }, to: { sectionId: "taxable", rowId: b.id } },
    ], advisor);
    const tickers = (s: FactFinderState) => s.sections.taxable.map((r) => r.holdings?.map((h) => h.ticker) ?? []);
    const again = mergeReadings(moved, [withHoldings("2026-06-30", [vti])], ctx).state;
    expect(tickers(again)).toEqual([[], ["VTI"]]);
    expect(mergeReadings(again, [withHoldings("2026-06-30", [vti])], ctx).state).toBe(again);
    expect(tickers(mergeReadings(again, [withHoldings("2026-09-30", [vti])], ctx).state)).toEqual([[], ["VTI"]]);
  });

  it("changes nothing when a statement arrives again after the advisor removed every holding", () => {
    const first = mergeReadings(emptyFactFinderState(), [withHoldings("2026-06-30", [vti])], ctx).state;
    const row = first.sections.taxable[0];
    const emptied = applyOps(first, [
      { op: "removeHolding", sectionId: "taxable", rowId: row.id, holdingId: row.holdings![0].id },
    ], advisor);
    expect(mergeReadings(emptied, [withHoldings("2026-06-30", [vti])], ctx).state).toBe(emptied);
    expect(mergeReadings(emptied, [withHoldings("2026-03-31", [vti])], ctx).state).toBe(emptied);
  });
});

describe("mergeReadings — unassigned holdings", () => {
  const holdingFor = (accountHint: string, ticker: string): FFUnassignedReading => ({
    fileId: "f9",
    accountHint,
    holding: { ticker, name: ticker, shares: 1, marketValue: 100 },
    source: { fileId: "f9", page: 10 },
  });
  const brokerage = (): FactFinderState =>
    mergeReadings(emptyFactFinderState(), [
      fidelity({ sectionId: "taxable" }, { accountName: cell("Joint Brokerage"), last4: cell("7731"), custodian: cell("Schwab") }),
    ], ctx).state;

  it("places a holding on the account named by last 4 or by name", () => {
    const { state } = mergeReadings(brokerage(), [], ctx, [holdingFor("7731", "VTI"), holdingFor("Joint Brokerage", "BND")]);
    expect(state.sections.taxable[0].holdings?.map((h) => h.ticker)).toEqual(["VTI", "BND"]);
    expect(state.unassignedHoldings).toEqual([]);
  });

  it("keeps a holding it can't place in the unassigned list, once", () => {
    const first = mergeReadings(brokerage(), [], ctx, [holdingFor("x9999", "AAPL")]);
    expect(first.state.unassignedHoldings).toMatchObject([{ ticker: "AAPL", accountHint: "x9999", by: "document" }]);
    expect(first.decisions).toEqual([{ kind: "holdingUnassigned", fileId: "f9", accountHint: "x9999" }]);
    expect(mergeReadings(first.state, [], ctx, [holdingFor("x9999", "AAPL")]).state).toBe(first.state);
  });

  it("doesn't bring back a holding the advisor already placed on an account", () => {
    const first = mergeReadings(brokerage(), [], ctx, [holdingFor("x9999", "AAPL")]).state;
    const placed = applyOps(first, [
      {
        op: "assignHolding",
        holdingId: first.unassignedHoldings[0].id,
        from: "unassigned",
        to: { sectionId: "taxable", rowId: first.sections.taxable[0].id },
      },
    ], advisor);
    const again = mergeReadings(placed, [], ctx, [holdingFor("x9999", "AAPL")]);
    expect(again.state).toBe(placed);
    expect(again.decisions).toEqual([]);
  });

  it("still lists a holding for an unknown account when the same file put that security on a known one", () => {
    const { state } = mergeReadings(brokerage(), [], ctx, [holdingFor("7731", "AAPL"), holdingFor("x9999", "AAPL")]);
    expect(state.sections.taxable[0].holdings?.map((h) => h.ticker)).toEqual(["AAPL"]);
    expect(state.unassignedHoldings).toMatchObject([{ ticker: "AAPL", accountHint: "x9999" }]);
  });
});
