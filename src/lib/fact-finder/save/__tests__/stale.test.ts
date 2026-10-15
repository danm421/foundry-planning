// src/lib/fact-finder/save/__tests__/stale.test.ts
import { describe, expect, it } from "vitest";
import type { ChangeLine, TargetKind } from "../../change-set";
import { buildChangeSet } from "../../placement/build";
import type { LeftoversOutput } from "../../placement/leftovers";
import { hendricksBook, linkedTo, recordOf, rowOf, stateWith } from "../../placement/__tests__/fixtures";
import type { BookRecord, RecordBook } from "../../placement/types";
import type { FactFinderState } from "../../types";
import { staleProblem } from "../stale";

const NOW = new Date("2026-03-15T12:00:00Z");
const CASH = { category: "cash", subType: "checking", parentAccountId: null, isDefaultChecking: false };
const AI_BODY = "Anything else we should know? — Notes: Laura plans to retire early if the business sells.";

/** Mark & Laura's plan as the advisor reviewed it: two accounts, and Mark's will with no provisions yet. */
const reviewed = hendricksBook({
  account: [
    recordOf("a-1", "Joint Checking", { name: "Joint Checking", value: 12000, growthRate: 0.04, custodian: "Chase" }, CASH),
    recordOf("a-2", "Schwab Brokerage", { name: "Schwab Brokerage", value: 90000 }, { ...CASH, category: "taxable", subType: "brokerage" }),
  ],
  will: [recordOf("w-1", "Mark's will", { grantor: "client" }, { grantor: "client" })],
  will_residuary_recipient: [recordOf("w-1", "Mark's will — remaining estate", { recipients: [] })],
});

/**
 * A line of each kind the check reads: the household (always the client's record), an account
 * linked to its record, a plan note and a related party matched by identity, a new will for
 * Laura, a provision on Mark's will naming an account only the plan has, and an AI plan note.
 */
const state: FactFinderState = stateWith({
  household: [rowOf("household:Household", { city: "Austin" })],
  cash: [rowOf("c1", { accountName: "Joint Checking", currentValue: 12500, interestRate: 4.5, custodian: "Chase Bank" }, { link: linkedTo("a-1") })],
  estate_docs: [
    rowOf("estate_docs:Client", { lastUpdatedYear: 2019, estateAttorney: "Jane Smith, Smith & Co" }),
    rowOf("estate_docs:Co-client", { will: true }),
  ],
  bequests: [rowOf("b1", { willOf: "Client", gift: "Specific asset", asset: "Schwab Brokerage", percent: 100, recipients: "Laura", condition: "Always" })],
  final_notes: [rowOf("final_notes:Notes", { notes: "Laura plans to retire early if the business sells." })],
});

/** The AI step keeps the closing notes as a plan note. */
const AI: LeftoversOutput = {
  items: [{ itemId: "final_notes:Notes:notes", action: "note", lineId: null, key: null, value: null, quote: null, topic: "retirement", reason: null }],
};

/** The review's change list for `state` against `book`. */
async function review(book: RecordBook = reviewed): Promise<ChangeLine[]> {
  return (await buildChangeSet({ state, book, now: NOW, runLeftovers: async () => AI })).lines;
}

/** What the save hands the check (Task 15): Create and Update lines that aren't blocked, ticked as the advisor left them, each with a field ticked. */
function planned(lines: readonly ChangeLine[], unticked: Record<string, string[]> = {}): ChangeLine[] {
  return lines
    .filter((l) => l.action !== "none" && !l.blocked)
    .map((l) => ({ ...l, fields: l.fields.map((f) => ({ ...f, ticked: f.ticked && !(unticked[l.id] ?? []).includes(f.key) })) }))
    .filter((l) => l.fields.some((f) => f.ticked));
}

/** `book` with `target`'s records run through `edit`. */
function edited(book: RecordBook, target: TargetKind, edit: (records: BookRecord[]) => BookRecord[]): RecordBook {
  return { ...book, records: { ...book.records, [target]: edit(book.records[target]) } };
}
const without = (book: RecordBook, target: TargetKind, id: string) => edited(book, target, (rs) => rs.filter((r) => r.id !== id));
const adding = (book: RecordBook, target: TargetKind, record: BookRecord) => edited(book, target, (rs) => [...rs, record]);
const changing = (book: RecordBook, target: TargetKind, id: string, values: BookRecord["values"]) =>
  edited(book, target, (rs) => rs.map((r) => (r.id === id ? { ...r, values: { ...r.values, ...values } } : r)));
const note = (id: string, body: string, topic = "general") => recordOf(id, body, { topic, body });

/** The check of the reviewed lines (reviewed against `opts.book`, ticks as left) against the book the save reloads. */
async function stale(now: RecordBook, opts: { book?: RecordBook; unticked?: Record<string, string[]> } = {}) {
  return staleProblem(planned(await review(opts.book), opts.unticked), state, now, NOW);
}

describe("staleProblem", () => {
  it("the reviewed change list the tests read: one line of each kind, none blocked", async () => {
    expect(planned(await review()).map((l) => [l.id, l.action, l.recordId])).toEqual([
      ["household:Household/client_household", "update", "c1"],
      ["c1/account", "update", "a-1"],
      ["estate_docs:Client/plan_observation", "create", null],
      ["estate_docs:Co-client/will", "create", null],
      ["estate_docs:Client/related_party", "create", null],
      ["b1/will_bequest", "create", null],
      ["final_notes:Notes/plan_observation/0", "create", null],
    ]);
  });

  it("a plan unchanged since the review is no problem — on a later day too", async () => {
    const lines = planned(await review());
    expect(staleProblem(lines, state, reviewed, NOW)).toBeNull();
    expect(staleProblem(lines, state, reviewed, new Date("2027-01-04T09:00:00Z"))).toBeNull();
  });

  it("a Links to whose record was deleted since names its row", async () => {
    expect(await stale(without(reviewed, "account", "a-1"))).toEqual({
      lineId: "c1/account",
      message: "“Joint Checking” is no longer on the plan — review again.",
    });
  });

  it("a deleted record linked from a row the save writes nothing from is no problem", async () => {
    expect(await stale(without(reviewed, "account", "a-1"), { unticked: { "c1/account": ["value", "custodian", "growthRate"] } })).toBeNull();
  });

  it("a record the review matched by its identity, deleted since", async () => {
    const withAttorney = adding(reviewed, "related_party", recordOf("rp-1", "Jane Smith", { firstName: "Jane", lastName: "Smith", employer: "Smith Law", notes: null }));
    expect(planned(await review(withAttorney)).find((l) => l.id === "estate_docs:Client/related_party")).toMatchObject({ action: "update", recordId: "rp-1" });
    expect(await stale(withAttorney, { book: withAttorney })).toBeNull();
    expect(await stale(reviewed, { book: withAttorney })).toEqual({
      lineId: "estate_docs:Client/related_party",
      message: "“Estate attorney — Jane Smith” is no longer on the plan — review again.",
    });
  });

  it.each([
    [
      "a will by the same person",
      adding(reviewed, "will", recordOf("w-2", "Laura's will", { grantor: "spouse" }, { grantor: "spouse" })),
      "estate_docs:Co-client/will",
      "“Laura's will” is on the plan now — review again.",
    ],
    [
      "a related party with the same name",
      adding(reviewed, "related_party", recordOf("rp-9", "Jane Smith", { firstName: "Jane", lastName: "Smith", employer: null, notes: null })),
      "estate_docs:Client/related_party",
      "“Estate attorney — Jane Smith” is on the plan now — review again.",
    ],
    [
      "a provision giving the same asset under the same will",
      adding(reviewed, "will_bequest", recordOf("bq-9", "Schwab Brokerage", { kind: "asset", condition: "always" }, { willId: "w-1", grantor: "client", assetKey: "account:a-2" })),
      "b1/will_bequest",
      "“Mark's will — Schwab Brokerage” is on the plan now — review again.",
    ],
    [
      "a plan note with the same words",
      adding(reviewed, "plan_observation", note("n-9", "Client's estate documents were last updated in 2019.")),
      "estate_docs:Client/plan_observation",
      "“Plan note: Client's estate documents were last updated in 2019.” is on the plan now — review again.",
    ],
    [
      "a plan note with the AI step's note's words",
      adding(reviewed, "plan_observation", note("n-9", AI_BODY)),
      "final_notes:Notes/plan_observation/0",
      "“Plan note: Notes (Anything else we should know?)” is on the plan now — review again.",
    ],
  ])("a Create whose record is on the plan now: %s added since", async (_kind, now, lineId, message) => {
    expect(await stale(now)).toEqual({ lineId, message });
  });

  describe("an AI plan note the review matched to a note on record by its words", () => {
    const withNote = adding(reviewed, "plan_observation", note("n-1", AI_BODY));
    const lineId = "final_notes:Notes/plan_observation/0";

    it("is an Update of that note, and no problem while the note stands", async () => {
      expect(planned(await review(withNote)).find((l) => l.id === lineId)).toMatchObject({ action: "update", recordId: "n-1", aiPlaced: true });
      expect(await stale(withNote, { book: withNote })).toBeNull();
    });

    it("its note's words edited since", async () => {
      expect(await stale(changing(withNote, "plan_observation", "n-1", { body: "Laura may retire early." }), { book: withNote })).toEqual({
        lineId,
        message: "“Plan note: Notes (Anything else we should know?)” changed since you reviewed — review again.",
      });
    });

    it("its note deleted since", async () => {
      expect(await stale(reviewed, { book: withNote })).toEqual({
        lineId,
        message: "“Plan note: Notes (Anything else we should know?)” is no longer on the plan — review again.",
      });
    });
  });

  it("an Update line whose record is gone", async () => {
    expect(await stale(edited(reviewed, "client_household", () => []))).toEqual({
      lineId: "household:Household/client_household",
      message: "“Household” is no longer on the plan — review again.",
    });
  });

  it("a line naming a record that's gone — a ticked value or the record it hangs off", async () => {
    const problem = { lineId: "b1/will_bequest", message: "“Mark's will — Schwab Brokerage” names a record that's no longer on the plan — review again." };
    expect(await stale(without(reviewed, "account", "a-2"))).toEqual(problem);
    expect(await stale(without(without(reviewed, "will", "w-1"), "will_residuary_recipient", "w-1"))).toEqual(problem);
  });

  it("a record named only in an unticked field isn't checked", async () => {
    expect(await stale(without(reviewed, "account", "a-2"), { unticked: { "b1/will_bequest": ["accountId"] } })).toBeNull();
  });

  it("a ticked field changed on record since", async () => {
    const message = "“Joint Checking” changed since you reviewed — review again.";
    expect(await stale(changing(reviewed, "account", "a-1", { value: 12100 }))).toEqual({ lineId: "c1/account", message });
    expect(await stale(changing(reviewed, "account", "a-1", { custodian: "JPMorgan Chase" }))).toEqual({ lineId: "c1/account", message });
    expect(await stale(changing(reviewed, "account", "a-1", { growthRate: null }))).toEqual({ lineId: "c1/account", message });
  });

  it("the review's tolerances: money 0.004 off and a rate 0.00004 off aren't changes; 0.006 and 0.00006 are", async () => {
    expect(await stale(changing(reviewed, "account", "a-1", { value: 12000.004, growthRate: 0.04004 }))).toBeNull();
    expect(await stale(changing(reviewed, "account", "a-1", { value: 12000.006 }))).toMatchObject({ lineId: "c1/account" });
    expect(await stale(changing(reviewed, "account", "a-1", { growthRate: 0.04006 }))).toMatchObject({ lineId: "c1/account" });
  });

  it("an unticked field changed on record since is no problem: the save doesn't write it", async () => {
    expect(await stale(changing(reviewed, "account", "a-1", { value: 12100 }), { unticked: { "c1/account": ["value"] } })).toBeNull();
  });

  it("reports the first problem by the order of the checks, then of the lines", async () => {
    const both = changing(adding(reviewed, "will", recordOf("w-2", "Laura's will", { grantor: "spouse" }, { grantor: "spouse" })), "account", "a-1", { value: 12100 });
    expect(await stale(both)).toEqual({ lineId: "estate_docs:Co-client/will", message: "“Laura's will” is on the plan now — review again." });
    const twoChanged = changing(changing(reviewed, "account", "a-1", { value: 12100 }), "client_household", "c1", { city: "Dallas" });
    expect(await stale(twoChanged)).toEqual({ lineId: "household:Household/client_household", message: "“Household” changed since you reviewed — review again." });
  });
});
