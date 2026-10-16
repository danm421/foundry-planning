// src/lib/fact-finder/placement/__tests__/build.test.ts
import { describe, expect, it, vi } from "vitest";
import type { ChangeLine, ChangeSet } from "../../change-set";
import type { FactFinderState, FFCell, FFRow } from "../../types";
import { blockDependents, buildChangeSet } from "../build";
import type { LeftoversOutput } from "../leftovers";
import type { LeftoverItem, RecordBook, TargetDraft } from "../types";
import { bookWith, hendricksBook, linkedTo, recordOf, rowOf, stateWith } from "./fixtures";

const NOW = new Date("2026-03-15T12:00:00Z");
type Answer = LeftoversOutput["items"][number];
const answer = (itemId: string, a: Partial<Answer>): Answer => ({
  itemId, action: "note", lineId: null, key: null, value: null, quote: null, topic: null, reason: null, ...a,
});

/** A document value that didn't fit its column: the reader kept the text, flagged. */
const unfit = (value: string, issue: FFCell["issue"] = "unparsed"): FFCell => ({ value, by: "document", confidence: 0.9, issue });
const withCells = (row: FFRow, cells: Record<string, FFCell>): FFRow => ({ ...row, cells: { ...row.cells, ...cells } });
const notes = (sectionId: string, text: string) => [rowOf(`${sectionId}:Notes`, { notes: text })];

function build(state: FactFinderState, book: RecordBook, output: LeftoversOutput | null = null) {
  const runLeftovers = vi.fn<(items: readonly LeftoverItem[], drafts: readonly TargetDraft[]) => Promise<LeftoversOutput | null>>(
    async () => output,
  );
  return { runLeftovers, built: buildChangeSet({ state, book, now: NOW, runLeftovers }) };
}
const line = (changeSet: Omit<ChangeSet, "builtAtVersion">, id: string): ChangeLine | undefined => changeSet.lines.find((l) => l.id === id);

const cashFacts = { category: "cash", subType: "checking", parentAccountId: null, isDefaultChecking: false };
const kids = {
  family_member: [
    recordOf("fm-emma", "Emma Hendricks", { firstName: "Emma", lastName: "Hendricks" }),
    recordOf("fm-lucas", "Lucas Hendricks", { firstName: "Lucas", lastName: "Hendricks" }),
  ],
};

describe("buildChangeSet — a small fact finder, end to end", () => {
  const book = hendricksBook({
    account: [
      recordOf("a-1", "Joint Checking ··1234", { name: "Joint Checking", value: 12000 }, cashFacts),
      recordOf("a-2", "Schwab Brokerage", { name: "Schwab Brokerage", value: 90000 }, { ...cashFacts, category: "taxable", subType: "brokerage" }),
    ],
  });
  const state: FactFinderState = {
    ...stateWith({
      cash: [
        rowOf("c1", { accountName: "Joint Checking", currentValue: 12500 }, { link: linkedTo("a-1") }),
        withCells(rowOf("c2", { accountName: "Emergency Savings", owner: "Client" }), { currentValue: unfit("about 20 thousand") }),
      ],
      taxable: [rowOf("t1", { accountName: "Schwab Brokerage", currentValue: 90000 }, { link: linkedTo("a-2") })],
      retirement: [
        withCells(rowOf("r1", { accountName: "Fidelity 401(k)", currentValue: 250000, primaryBeneficiary: "Laura" }), {
          owner: unfit("Mark & Laura", "notAnOption"),
        }),
      ],
      insurance_notes: notes("insurance_notes", "n/a"),
      final_notes: notes("final_notes", "Laura plans to retire early if the business sells."),
    }),
    unassignedHoldings: [
      { id: "h1", ticker: "VTI", name: null, shares: 10, price: null, marketValue: null, costBasis: null, by: "document", accountHint: "…9911" },
    ],
  };
  const output: LeftoversOutput = {
    items: [
      answer("c2:currentValue", { action: "field", lineId: "c2/account", key: "value", value: "20000", quote: "20 thousand" }),
      answer("insurance_notes:Notes:notes", { action: "skip", reason: "nothing to keep" }),
      answer("final_notes:Notes:notes", { action: "note", topic: "retirement" }),
    ],
  };

  it("places, asks the AI once about what's left over, diffs, and checks every line", async () => {
    const { runLeftovers, built } = build(state, book, output);
    const changeSet = await built;

    expect(runLeftovers).toHaveBeenCalledTimes(1);
    const [items, drafts] = runLeftovers.mock.calls[0];
    expect(items.map((i) => i.id)).toEqual(["c2:currentValue", "insurance_notes:Notes:notes", "final_notes:Notes:notes"]);
    expect(drafts.map((d) => d.lineId)).toEqual(["c1/account", "c2/account", "t1/account", "r1/account", "r1/account_beneficiary_designation"]);

    expect(changeSet.builtAt).toBe("2026-03-15T12:00:00.000Z");
    expect(changeSet.lines.map((l) => [l.id, l.action, l.blocked?.reason ?? null])).toEqual([
      ["c1/account", "update", null],
      ["c2/account", "create", null],
      ["t1/account", "none", null],
      ["r1/account", "create", 'Owner: "Mark & Laura" isn\'t one of the options — pick one.'],
      ["r1/account_beneficiary_designation", "create", 'Saves only with "Fidelity 401(k)", which can\'t be saved yet.'],
      ["final_notes:Notes/plan_observation/0", "create", null],
    ]);
    // The runner's notices first, then the AI step's.
    expect(changeSet.notices).toEqual([
      "1 holding isn't assigned to an account and won't be saved.",
      "Not placed: Notes (Group / employer coverage & notes) — nothing to keep",
    ]);
  });

  it("an update shows on record → new, a field the AI filled carries its quote, and the AI's note is a plan note", async () => {
    const changeSet = await build(state, book, output).built;

    expect(line(changeSet, "c1/account")?.fields).toEqual([
      {
        key: "value", label: "Current value", next: 12500, onRecord: 12000,
        shown: { next: "$12,500", onRecord: "$12,000" }, ticked: true,
        from: [{ sectionId: "cash", rowId: "c1", columnId: "currentValue" }],
      },
    ]);
    expect(line(changeSet, "c2/account")?.fields.find((f) => f.key === "value")).toEqual({
      key: "value", label: "Current value", next: 20000, shown: { next: "$20,000" }, ticked: true,
      from: [{ sectionId: "cash", rowId: "c2", columnId: "currentValue" }], ai: { quote: "20 thousand" },
    });
    const note = line(changeSet, "final_notes:Notes/plan_observation/0");
    expect(note).toMatchObject({
      label: "Plan note: Notes (Anything else we should know?)",
      recordId: null,
      aiPlaced: true,
      fixed: { section: "observation", audience: "advisor", source: "ai" },
    });
    expect(note?.fields.map((f) => [f.key, f.next])).toEqual([
      ["topic", "retirement"],
      ["body", "Anything else we should know? — Notes: Laura plans to retire early if the business sells."],
    ]);
  });

  it("when the AI step fails the change list still builds: no AI field, no plan notes, a notice naming the notes", async () => {
    const changeSet = await build(state, book, null).built;
    expect(line(changeSet, "c2/account")?.fields.map((f) => f.key)).toEqual(["name", "owners"]);
    expect(changeSet.lines.some((l) => l.aiPlaced)).toBe(false);
    expect(changeSet.notices).toEqual([
      "1 holding isn't assigned to an account and won't be saved.",
      "Couldn't place 3 notes automatically: Current value (Emergency Savings), Notes (Group / employer coverage & notes), Notes (Anything else we should know?). Review again to retry.",
    ]);
  });

  it("asks the AI nothing when nothing is left over", async () => {
    const { runLeftovers, built } = build(stateWith({ cash: [rowOf("c1", { accountName: "Joint Checking", currentValue: 12500 }, { link: linkedTo("a-1") })] }), book);
    const changeSet = await built;
    expect(runLeftovers).not.toHaveBeenCalled();
    expect(changeSet.lines.map((l) => l.id)).toEqual(["c1/account"]);
    expect(changeSet.notices).toEqual([]);
  });
});

describe("buildChangeSet — the co-client the review saw", () => {
  it("records whether the plan has the co-client's family member, for the save to compare with the plan it reloads", async () => {
    const state = stateWith({ cash: [rowOf("c1", { accountName: "Emergency Savings", currentValue: 20000, owner: "Client" })] });
    expect((await build(state, hendricksBook()).built).hasCoClient).toBe(true);
    expect((await build(state, bookWith({}, { people: { client: "fm-client", spouse: null } })).built).hasCoClient).toBe(false);
  });
});

describe("buildChangeSet — two lines changing one field of one record (RULING)", () => {
  const book = hendricksBook({
    business_account: [
      recordOf("biz-1", "Hendricks Design LLC", { name: "Hendricks Design LLC" }, { category: "business", subType: null, parentAccountId: null, isDefaultChecking: false }),
    ],
    expense: [
      recordOf("exp-1", "Hendricks Design LLC expenses", { name: "Hendricks Design LLC expenses", annualAmount: 30000 }, { type: "other", livingSlot: null, ownerAccountId: "biz-1" }),
    ],
  });

  it("an Other Expenses row linked to the business's expense, which the Business row's line also changes: both are blocked", async () => {
    const changeSet = await build(
      stateWith({
        business: [rowOf("b1", { businessName: "Hendricks Design LLC", annualExpense: 36000 }, { link: linkedTo("biz-1") })],
        expenses: [rowOf("x1", { expenseName: "Studio rent", annualAmount: 40000 }, { link: linkedTo("exp-1") })],
      }),
      book,
    ).built;

    expect(line(changeSet, "b1/business_account")?.action).toBe("none");
    expect(line(changeSet, "b1/expense")).toMatchObject({
      recordId: "exp-1",
      blocked: {
        reason: '"Hendricks Design LLC expenses" and "Studio rent" both change Annual amount on the same record — clear it in one of them.',
        cell: { sectionId: "business", rowId: "b1", columnId: "annualExpense" },
      },
    });
    expect(line(changeSet, "x1/expense")).toMatchObject({
      recordId: "exp-1",
      blocked: {
        reason: '"Studio rent" and "Hendricks Design LLC expenses" both change Annual amount on the same record — clear it in one of them.',
        cell: { sectionId: "expenses", rowId: "x1", columnId: "annualAmount" },
      },
    });
  });

  it("lines on one record that change different fields are left alone (the household's lines)", async () => {
    const changeSet = await build(
      stateWith({
        people: [rowOf("people:Client", { firstName: "Mark", email: "mark@example.com" })],
        household: [rowOf("household:Household", { city: "Austin" })],
      }),
      book,
    ).built;
    expect(changeSet.lines.map((l) => [l.id, l.action, l.recordId, l.fields.map((f) => f.key), l.blocked])).toEqual([
      ["people:Client/client_household", "update", "c1", ["email"], undefined],
      ["household:Household/client_household", "update", "c1", ["city"], undefined],
    ]);
  });
});

describe("buildChangeSet — a line that needs a line which can't save (RULING)", () => {
  it("blocks every line that hangs off a blocked one, to a fixed point: a CLT's beneficiaries, an account it owns, savings into that account", async () => {
    const changeSet = await build(
      stateWith({
        cash: [rowOf("c1", { accountName: "Trust Checking", currentValue: 5000, owner: "Trust / entity", ownerEntity: "Hendricks Charitable Lead Trust" })],
        savings: [rowOf("s1", { account: "Trust Checking", contribution: "Fixed $ amount", annualAmount: 1000 })],
        trusts: [rowOf("t1", { trustName: "Hendricks Charitable Lead Trust", trustType: "CLT", grantor: "Client", remainderBeneficiaries: "Emma 50%, Lucas 50%" })],
      }),
      hendricksBook(kids),
    ).built;

    expect(changeSet.lines.map((l) => [l.id, l.blocked])).toEqual([
      ["c1/account", { reason: 'Saves only with "Hendricks Charitable Lead Trust", which can\'t be saved yet.' }],
      ["s1/savings_rule", { reason: 'Saves only with "Trust Checking", which can\'t be saved yet.' }],
      [
        "t1/entity",
        {
          reason: "A charitable lead or remainder trust needs its split-interest terms — add it in Details.",
          cell: { sectionId: "trusts", rowId: "t1", columnId: "trustType" },
        },
      ],
      ["t1/trust_beneficiary_designation", { reason: 'Saves only with "Hendricks Charitable Lead Trust", which can\'t be saved yet.' }],
    ]);
  });
});

describe("buildChangeSet — an AI value the Details checks refuse (RULING)", () => {
  const book = hendricksBook({ liability: [recordOf("liab-1", "Car loan", { name: "Car loan", balance: 16000 })] });
  const carLoan = { loanName: "Car loan", owner: "Client", balance: 15000, interestRate: 5, monthlyPI: 400, loanStart: "2022-06" };
  const finalNotes = notes("final_notes", "The car loan runs 99999 months, believe it or not.");
  const termAnswer = answer("final_notes:Notes:notes", {
    action: "field", lineId: "l1/liability", key: "termMonths", value: "99999", quote: "99999 months",
  });

  it("never blocks a line the map built cleanly: the value is dropped and the note kept as a plan note in its own words", async () => {
    const state = stateWith({ liab: [rowOf("l1", carLoan, { link: linkedTo("liab-1") })], final_notes: finalNotes });
    expect(line(await build(state, book).built, "l1/liability")?.blocked).toBeUndefined();

    const changeSet = await build(state, book, { items: [termAnswer] }).built;
    const car = line(changeSet, "l1/liability");
    expect(car?.action).toBe("update");
    expect(car?.blocked).toBeUndefined();
    expect(car?.fields.map((f) => f.key)).not.toContain("termMonths");
    const note = line(changeSet, "final_notes:Notes/plan_observation/0");
    expect(note?.aiPlaced).toBe(true);
    expect(note?.blocked).toBeUndefined();
    expect(note?.fields.map((f) => [f.key, f.next])).toEqual([
      ["topic", "general"],
      ["body", "Anything else we should know? — Notes: The car loan runs 99999 months, believe it or not."],
    ]);
  });

  it("leaves a line blocked, AI value and all, when it can't save without that value either", async () => {
    const state = stateWith({ liab: [rowOf("l1", carLoan)], final_notes: finalNotes });
    expect(line(await build(state, book).built, "l1/liability")?.blocked?.reason).toBe("Needs Term (months).");

    const changeSet = await build(state, book, { items: [termAnswer] }).built;
    expect(line(changeSet, "l1/liability")?.blocked?.reason).toBe("Term (months): must be 12000 or less.");
    expect(line(changeSet, "l1/liability")?.fields.find((f) => f.key === "termMonths")?.ai).toEqual({ quote: "99999 months" });
    expect(changeSet.lines.some((l) => l.target === "plan_observation")).toBe(false);
  });
});

describe("blockDependents — a line that needs a line the change set doesn't have (RULING)", () => {
  const lineOf = (id: string, label: string, extra: Partial<ChangeLine> = {}): ChangeLine => ({
    id, page: "accounts", sectionId: "cash", rowId: id.split("/")[0], target: "account", action: "create",
    recordId: null, label, fields: [], warnings: [], ...extra,
  });
  const state = stateWith({ cash: [rowOf("c9", { accountName: "Trust Checking" })] });

  it("fails closed, naming the row the missing line would come from — and what hangs off it follows", () => {
    const savings = lineOf("s1/savings_rule", "Savings into Trust Checking", { target: "savings_rule", dependsOn: ["c9/account"] });
    const designation = lineOf("s2/account_beneficiary_designation", "Beneficiaries", {
      parent: { ref: "line", target: "account", lineId: "gone/account" },
    });
    const after = lineOf("s3/savings_rule", "After", { target: "savings_rule", dependsOn: ["s1/savings_rule"] });
    expect(blockDependents([savings, designation, after], state).map((l) => [l.id, l.blocked])).toEqual([
      ["s1/savings_rule", { reason: 'This depends on "Trust Checking", which won\'t be saved.' }],
      ["s2/account_beneficiary_designation", { reason: 'This depends on "Account", which won\'t be saved.' }],
      ["s3/savings_rule", { reason: 'Saves only with "Savings into Trust Checking", which can\'t be saved yet.' }],
    ]);
  });

  it("leaves a line whose needs are all in the change set and saveable", () => {
    const account = lineOf("c9/account", "Trust Checking");
    const savings = lineOf("s1/savings_rule", "Savings", { target: "savings_rule", dependsOn: ["c9/account"] });
    expect(blockDependents([account, savings], state)).toEqual([account, savings]);
  });
});
