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
});

describe("mergeReadings — precedence", () => {
  const base = () => mergeReadings(emptyFactFinderState(), [fidelity()], ctx).state;

  it("never changes a pinned cell", () => {
    const pinned = applyOps(base(), [
      { op: "setCell", sectionId: "retirement", rowId: "id-1", columnId: "currentValue", value: 650000 },
    ], advisor);
    const { state } = mergeReadings(pinned, [fidelity({ statementDate: "2026-09-30" }, { currentValue: cell(640000) })], ctx);
    expect(state.sections.retirement[0].cells.currentValue).toEqual({ value: 650000, by: "advisor", pinned: true });
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
    const { state } = mergeReadings(s, [
      fidelity({ fileId: "f3", statementDate: "2026-09-30" }, {
        accountName: cell("401k x2299", 0.9, "f3"),
        last4: cell("2299", 0.9, "f3"),
        currentValue: cell(611000, 0.9, "f3"),
      }),
    ], ctx);
    expect(state.sections.retirement.map((r) => r.id)).toEqual(["id-1"]);
    expect(state.sections.retirement[0].cells.currentValue.value).toBe(611000);
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
});
