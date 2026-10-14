// src/lib/fact-finder/placement/__tests__/links.test.ts
import { describe, expect, it } from "vitest";
import type { FFLink } from "../../types";
import { checkLinks, dropLinks } from "../links";
import { bookWith, linkedTo, recordOf, rowOf, stateWith } from "./fixtures";

/** A link the matcher suggested ("74%?") that the advisor hasn't clicked yet. */
const suggested = (recordId: string): FFLink => ({ kind: "existing", recordId, score: 0.74, confirmed: false, by: "auto" });

const book = bookWith({
  account: [recordOf("a-1", "Joint Checking ··1234", { name: "Joint Checking" })],
  business_account: [recordOf("biz-1", "Hendricks Design LLC", { name: "Hendricks Design LLC" })],
  liability: [recordOf("l-1", "Car Loan", { name: "Car Loan" })],
});
const NONE = { vanished: [], needsClick: 0, doubles: [] };

describe("checkLinks", () => {
  it("passes confirmed links to this client's records, and rows with no link or a New one", () => {
    const state = stateWith({
      cash: [
        rowOf("c1", { accountName: "Joint Checking" }, { link: linkedTo("a-1") }),
        rowOf("c2", { accountName: "Emergency Savings" }, { link: { kind: "new", by: "auto" } }),
        rowOf("c3", { accountName: "Petty Cash" }),
      ],
      liab: [rowOf("l1", { loanName: "Car Loan" }, { link: linkedTo("l-1") })],
    });
    expect(checkLinks(state, book)).toEqual(NONE);
  });

  it("a link to another client's record, or to one deleted since, has vanished — confirmed or suggested (Review Focus 3)", () => {
    const state = stateWith({
      cash: [
        rowOf("c1", { accountName: "Joint Checking" }, { link: linkedTo("a-of-another-client") }),
        rowOf("c2", { accountName: "Old Savings" }, { link: suggested("a-deleted") }),
      ],
      ss: [rowOf("ss:Client", { monthlyBenefit: 2400 }, { link: linkedTo("income-gone") })],
    });
    expect(checkLinks(state, book)).toEqual({
      vanished: [
        { rowId: "c1", label: "Joint Checking" },
        { rowId: "c2", label: "Old Savings" },
        { rowId: "ss:Client", label: "Social Security — Client" },
      ],
      needsClick: 0,
      doubles: [],
    });
  });

  it("a link names a record of its own kind: an account row may name a business (the matcher's pool), not a debt", () => {
    const state = stateWith({
      cash: [
        rowOf("c1", { accountName: "Business Checking" }, { link: linkedTo("biz-1") }),
        rowOf("c2", { accountName: "Car Fund" }, { link: linkedTo("l-1") }),
      ],
      liab: [rowOf("l1", { loanName: "Card" }, { link: linkedTo("a-1") })],
    });
    expect(checkLinks(state, book).vanished).toEqual([
      { rowId: "c2", label: "Car Fund" },
      { rowId: "l1", label: "Card" },
    ]);
  });

  it("counts the suggestions still waiting for a click", () => {
    const state = stateWith({
      cash: [rowOf("c1", { accountName: "Joint Checking" }, { link: suggested("a-1") })],
      liab: [rowOf("l1", { loanName: "Car Loan" }, { link: suggested("l-1") })],
    });
    expect(checkLinks(state, book)).toEqual({ ...NONE, needsClick: 2 });
  });

  it("two live rows in two sections confirmed to one account are a double, named by both rows (Review Focus 2)", () => {
    const state = stateWith({
      cash: [rowOf("c1", { accountName: "Joint Checking" }, { link: linkedTo("a-1") })],
      taxable: [rowOf("t1", { accountName: "Chase Joint" }, { link: linkedTo("a-1") })],
      liab: [rowOf("l1", { loanName: "Car Loan" }, { link: linkedTo("l-1") })],
    });
    expect(checkLinks(state, book)).toEqual({
      ...NONE,
      doubles: [{ recordId: "a-1", rows: [{ rowId: "c1", label: "Joint Checking" }, { rowId: "t1", label: "Chase Joint" }] }],
    });
  });

  it("reads live rows only: a removed row's link is never vanished, nor half of a double", () => {
    const at = "2026-03-01T00:00:00Z";
    const state = {
      ...stateWith({ cash: [rowOf("c1", { accountName: "Joint Checking" }, { link: linkedTo("a-1") })] }),
      removed: [
        { sectionId: "cash", row: rowOf("c8", { accountName: "Joint Checking" }, { link: linkedTo("a-1") }), reason: "Duplicate", by: "advisor" as const, at },
        { sectionId: "cash", row: rowOf("c9", { accountName: "Old Savings" }, { link: linkedTo("a-gone") }), reason: "Closed", by: "advisor" as const, at },
      ],
    };
    expect(checkLinks(state, book)).toEqual(NONE);
  });
});

describe("dropLinks", () => {
  it("takes the link and its candidates off the named rows only", () => {
    const candidates = [{ recordId: "a-gone", label: "Joint Checking", score: 1 }];
    const state = stateWith({
      cash: [
        rowOf("c1", { accountName: "Joint Checking" }, { link: linkedTo("a-gone"), linkCandidates: candidates }),
        rowOf("c2", { accountName: "Old Savings" }, { link: linkedTo("a-1"), linkCandidates: candidates }),
      ],
    });
    const dropped = dropLinks(state, new Set(["c1"]));
    expect(dropped.sections.cash[0]).toEqual(rowOf("c1", { accountName: "Joint Checking" }));
    expect(dropped.sections.cash[1]).toBe(state.sections.cash[1]);
    expect(state.sections.cash[0].link).toEqual(linkedTo("a-gone"));
  });
});
