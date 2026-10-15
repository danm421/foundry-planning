// src/lib/fact-finder/placement/map/__tests__/expenses-savings.test.ts
import { describe, expect, it } from "vitest";
import { findSection } from "../../../schema";
import type { FFRow } from "../../../types";
import { contextOf, hendricksBook, linkedTo, recordOf, rowOf, stateWith } from "../../__tests__/fixtures";
import { diffDrafts } from "../../diff";
import type { RecordBook } from "../../types";
import { EXPENSES_MAP, LIVING_ITEMS_MAP, LIVING_MAP, SAVINGS_MAP } from "../expenses-savings";
import type { SectionMap } from "../types";

const cell = (sectionId: string, rowId: string, columnId: string) => ({ sectionId, rowId, columnId });
const facts = (type: string, livingSlot: string | null = null) => ({ type, livingSlot, ownerAccountId: null });

const current = recordOf(
  "exp-cur", "Current living expenses",
  { name: "Current living expenses", type: "living", annualAmount: 96000, start: { yearRef: "plan_start" }, end: { yearRef: "client_retirement" }, livingItems: null },
  facts("living", "current"),
);
const retirement = recordOf(
  "exp-ret", "Retirement living expenses",
  { name: "Retirement living expenses", type: "living", annualAmount: 80000, start: { yearRef: "client_retirement" }, end: { yearRef: "plan_end" } },
  facts("living", "retirement"),
);
const travel = recordOf("exp-1", "Travel", { name: "Travel", type: "other", annualAmount: 10000, start: 2026, end: 2040 }, facts("other"));
const livingBook = () => hendricksBook({ expense: [current, retirement, travel] });

/** `map` places `rows` against `book`; the fact finder also holds `sections`. `removed`: "rowId:columnId" cells the runner took out (they didn't read). */
function place(map: SectionMap, rows: FFRow[], book: RecordBook, sections: Record<string, FFRow[]> = {}, removed: string[] = []) {
  const { ctx } = contextOf(stateWith({ ...sections, [map.sectionId]: rows }), book);
  return map.place(rows, { ...ctx, removed: (rowId, columnId) => removed.includes(`${rowId}:${columnId}`) });
}

describe("placements", () => {
  it.each([LIVING_MAP, LIVING_ITEMS_MAP, EXPENSES_MAP, SAVINGS_MAP])("$sectionId places every column exactly once", (map) => {
    expect(Object.keys(map.placements).sort()).toEqual(findSection(map.sectionId)?.columns.map((c) => c.id).sort());
  });
});

describe("LIVING_MAP", () => {
  const from = (rowId: string, columnId: string) => [cell("living", rowId, columnId)];

  it("a filled Current row updates the plan's current living expenses; a typed end year replaces its default timing", () => {
    const row = rowOf("living:Current", { annualAmount: 102000, annualIncrease: 3, endYear: 2040, notes: "Includes travel" }, { link: linkedTo("exp-cur") });
    expect(place(LIVING_MAP, [row], livingBook())).toEqual([
      {
        lineId: "living:Current/expense", sectionId: "living", rowId: "living:Current", target: "expense",
        recordId: "exp-cur", label: "Current living expenses",
        fields: [
          { key: "annualAmount", value: 102000, from: from("living:Current", "annualAmount") },
          { key: "growthRate", value: 0.03, from: from("living:Current", "annualIncrease"), with: { growthSource: "custom" } },
          { key: "end", value: 2040, from: from("living:Current", "endYear") },
        ],
        warnings: ["A typed year replaces the plan's default timing for this row."],
      },
    ]);
  });

  it("a typed start year isn't saved — the plan finds its living rows by where they start", () => {
    const drafts = place(
      LIVING_MAP,
      [rowOf("living:Current", { annualAmount: 100000, startYear: 2027 }), rowOf("living:In retirement", { startYear: 2035 })],
      livingBook(),
    );
    expect(drafts.map((d) => [d.recordId, d.fields.map((f) => f.key), d.warnings])).toEqual([
      ["exp-cur", ["annualAmount"], ["Start year isn't saved — the plan's current living expenses start with the plan; change it in Details."]],
      ["exp-ret", [], ["Start year isn't saved — the plan's retirement living expenses start at retirement; change it in Details."]],
    ]);
    expect(LIVING_MAP.placements.startYear).toHaveProperty("context");
  });

  it("a row with only a Start year is \"No changes\" that still says the start year isn't saved", () => {
    const book = livingBook();
    const [line] = diffDrafts(place(LIVING_MAP, [rowOf("living:Current", { startYear: 2027 })], book), book);
    expect([line.action, line.warnings]).toEqual([
      "none",
      ["Start year isn't saved — the plan's current living expenses start with the plan; change it in Details."],
    ]);
  });

  it("the In retirement row updates the retirement row; a blank cell makes no field; a row with only notes makes no line", () => {
    const drafts = place(
      LIVING_MAP,
      [rowOf("living:Current", { notes: "Tight budget" }), rowOf("living:In retirement", { annualAmount: 85000, annualIncrease: null })],
      livingBook(),
    );
    expect(drafts).toEqual([
      {
        lineId: "living:In retirement/expense", sectionId: "living", rowId: "living:In retirement", target: "expense",
        recordId: "exp-ret", label: "Retirement living expenses",
        fields: [{ key: "annualAmount", value: 85000, from: from("living:In retirement", "annualAmount") }],
        warnings: [],
      },
    ]);
  });

  it("the link never names another record: one not in the book, the other living row or another expense falls back to the row's own", () => {
    for (const recordId of ["exp-of-another-client", "exp-ret", "exp-1"]) {
      const row = rowOf("living:Current", { annualAmount: 100000 }, { link: linkedTo(recordId) });
      expect(place(LIVING_MAP, [row], livingBook())[0].recordId).toBe("exp-cur");
    }
  });

  it("the link picks among several current rows — and the itemized list follows it", () => {
    const second = recordOf("exp-cur-2", "Current spending", { annualAmount: 50000 }, facts("living", "current"));
    const book = hendricksBook({ expense: [current, second] });
    const living = rowOf("living:Current", { annualAmount: 100000 }, { link: linkedTo("exp-cur-2") });
    const items = [rowOf("li1", { item: "Groceries", amount: 800 })];
    expect(place(LIVING_MAP, [living], book)[0].recordId).toBe("exp-cur-2");
    expect(place(LIVING_ITEMS_MAP, items, book, { living: [living] })[0].recordId).toBe("exp-cur-2");
  });

  it("a plan with no living row of that kind is blocked — they're seeded, never made here", () => {
    const drafts = place(
      LIVING_MAP,
      [rowOf("living:Current", { annualAmount: 100000 }), rowOf("living:In retirement", { annualAmount: 80000 })],
      hendricksBook({ expense: [travel] }),
    );
    expect(drafts.map((d) => [d.recordId, d.label, d.blocked])).toEqual([
      [null, "Current living expenses", { reason: "This plan has no current living expense row." }],
      [null, "Retirement living expenses", { reason: "This plan has no retirement living expense row." }],
    ]);
  });
});

describe("LIVING_ITEMS_MAP", () => {
  const items = [
    rowOf("li1", { item: "Groceries", amount: 800, frequency: "Monthly" }),
    rowOf("li2", { item: "Travel", amount: 6000, frequency: "Annually" }),
    rowOf("li3", { item: "Dining out" }),
    rowOf("li4", { amount: 150 }),
  ];
  const replaces = (current: string) => `The itemized total ($17,400 a year) replaces Living Expenses — Current (${current}).`;

  it("the rows with an amount are one list on the current living expenses row", () => {
    const book = hendricksBook({ expense: [{ ...current, values: { ...current.values, annualAmount: 17400 } }] });
    expect(place(LIVING_ITEMS_MAP, items, book)).toEqual([
      {
        lineId: "li1/expense", sectionId: "living_items", rowId: "li1", target: "expense",
        recordId: "exp-cur", label: "Itemized living expenses",
        fields: [
          {
            key: "livingItems",
            value: [
              { name: "Groceries", amount: 800, frequency: "monthly" },
              { name: "Travel", amount: 6000, frequency: "annual" },
              { name: "Item", amount: 150, frequency: "monthly" },
            ],
            from: [
              cell("living_items", "li1", "item"), cell("living_items", "li1", "amount"), cell("living_items", "li1", "frequency"),
              cell("living_items", "li2", "item"), cell("living_items", "li2", "amount"), cell("living_items", "li2", "frequency"),
              cell("living_items", "li4", "amount"),
            ],
          },
        ],
        warnings: [],
      },
    ]);
  });

  it("a total that differs from Living Expenses — Current is said on both lines: the fact finder's Current first, else on record", () => {
    const living = rowOf("living:Current", { annualAmount: 100000 });
    expect(place(LIVING_ITEMS_MAP, items, livingBook(), { living: [living] })[0].warnings).toEqual([replaces("$100,000")]);
    expect(place(LIVING_MAP, [living], livingBook(), { living_items: items })[0].warnings).toEqual([replaces("$100,000")]);
    expect(place(LIVING_ITEMS_MAP, items, livingBook())[0].warnings).toEqual([replaces("$96,000")]);
  });

  it("the same items on record (in any order) replace nothing — no warning", () => {
    const onRecord = [
      { name: "Item", amount: 150, frequency: "monthly" },
      { name: "Travel", amount: 6000, frequency: "annual" },
      { name: "Groceries", amount: 800, frequency: "monthly" },
    ];
    const book = hendricksBook({ expense: [{ ...current, values: { ...current.values, livingItems: onRecord } }] });
    const living = rowOf("living:Current", { annualAmount: 100000 });
    expect(place(LIVING_ITEMS_MAP, items, book, { living: [living] })[0].warnings).toEqual([]);
    expect(place(LIVING_MAP, [living], book, { living_items: items })[0].warnings).toEqual([]);
  });

  it("item names alone (the form pre-prints them) make no line", () => {
    expect(place(LIVING_ITEMS_MAP, [rowOf("li1", { item: "Groceries" }), rowOf("li2", { item: "Utilities", frequency: "Monthly" })], livingBook())).toEqual([]);
  });

  it("an Amount that didn't read blocks the list on that cell — the list would replace the plan's without the item", () => {
    const why = '"Amount" didn\'t read as a number — enter it, or clear it to leave this item out of the list.';
    const [draft] = place(LIVING_ITEMS_MAP, items, livingBook(), {}, ["li3:amount"]);
    expect(draft.blocked).toEqual({ reason: why, cell: cell("living_items", "li3", "amount") });
    // A row whose only value was that Amount reads empty, so the runner never hands it to the map — still blocked.
    const { ctx } = contextOf(stateWith({ living_items: [...items, rowOf("li5", {})] }), livingBook());
    const [emptied] = LIVING_ITEMS_MAP.place(items, { ...ctx, removed: (rowId, columnId) => rowId === "li5" && columnId === "amount" });
    expect(emptied.blocked).toEqual({ reason: why, cell: cell("living_items", "li5", "amount") });
  });

  it("a plan with no current living expense row blocks the list", () => {
    const [draft] = place(LIVING_ITEMS_MAP, items, hendricksBook({ expense: [retirement] }));
    expect(draft.recordId).toBeNull();
    expect(draft.blocked).toEqual({ reason: "This plan has no current living expense row." });
  });
});

describe("EXPENSES_MAP", () => {
  const from = (columnId: string) => [cell("expenses", "e1", columnId)];

  it("a filled row is a new expense with every column", () => {
    const row = rowOf("e1", {
      expenseName: "Travel", type: "Other", annualAmount: 12000, annualIncrease: 2.5, startYear: 2027, endYear: 2045, isGoal: true, notes: "Europe in 2030",
    });
    expect(place(EXPENSES_MAP, [row], livingBook())).toEqual([
      {
        lineId: "e1/expense", sectionId: "expenses", rowId: "e1", target: "expense", recordId: null, label: "Travel",
        fields: [
          { key: "name", value: "Travel", from: from("expenseName") },
          { key: "type", value: "other", from: from("type") },
          { key: "annualAmount", value: 12000, from: from("annualAmount") },
          { key: "growthRate", value: 0.025, from: from("annualIncrease"), with: { growthSource: "custom" } },
          { key: "start", value: 2027, from: from("startYear") },
          { key: "end", value: 2045, from: from("endYear") },
          { key: "isGoal", value: true, from: from("isGoal") },
        ],
        warnings: [],
      },
    ]);
  });

  it("a new expense with no years starts this year and runs to the plan's end, growing with inflation", () => {
    const [draft] = place(EXPENSES_MAP, [rowOf("e1", { expenseName: "Parent care", type: "Other", annualAmount: 18000 })], livingBook());
    expect(draft.fixed).toEqual({ growthSource: "inflation" });
    expect(draft.fields.slice(3)).toEqual([
      { key: "start", value: 2026, from: [] },
      { key: "end", value: { yearRef: "plan_end" }, from: [] },
    ]);
  });

  it("a Start or End year that didn't read gets no default", () => {
    const row = rowOf("e1", { expenseName: "Parent care", type: "Other", annualAmount: 18000 });
    const [draft] = place(EXPENSES_MAP, [row], livingBook(), {}, ["e1:startYear", "e1:endYear"]);
    expect(draft.fields.map((f) => f.key)).toEqual(["name", "type", "annualAmount"]);
  });

  it("an Annual increase % that didn't read: the new expense grows with inflation, and the line says so", () => {
    const row = rowOf("e1", { expenseName: "Parent care", type: "Other", annualAmount: 18000 });
    const [draft] = place(EXPENSES_MAP, [row], livingBook(), {}, ["e1:annualIncrease"]);
    expect(draft.fixed).toEqual({ growthSource: "inflation" });
    expect(draft.warnings).toEqual(['"Annual increase %" didn\'t read — this expense grows with inflation until you set it.']);
  });

  it("an expense on record: only the filled cells, no default years", () => {
    const row = rowOf("e1", { expenseName: null, annualAmount: 11000, startYear: null, isGoal: false }, { link: linkedTo("exp-1") });
    const [draft] = place(EXPENSES_MAP, [row], livingBook());
    expect(draft).toMatchObject({
      recordId: "exp-1", label: "Travel",
      fields: [{ key: "annualAmount", value: 11000 }, { key: "isGoal", value: false, from: from("isGoal") }],
    });
    expect(draft.fixed).toBeUndefined();
  });

  it("a link to a record not in the book, or to a living expense row, never updates it", () => {
    for (const recordId of ["exp-of-another-client", "exp-cur", "exp-ret"]) {
      const row = rowOf("e1", { expenseName: "Travel", annualAmount: 11000 }, { link: linkedTo(recordId) });
      expect(place(EXPENSES_MAP, [row], livingBook())[0].recordId).toBeNull();
    }
  });
});

describe("SAVINGS_MAP", () => {
  const client = { ref: "person", role: "client" } as const;
  const spouse = { ref: "person", role: "spouse" } as const;
  const brokerage = recordOf(
    "acct-brk", "Schwab Brokerage",
    { name: "Schwab Brokerage", owners: [{ who: client, percent: 0.5 }, { who: spouse, percent: 0.5 }] },
    { category: "taxable" },
  );
  const laura401k = recordOf(
    "acct-401", "Brightside 401(k) ··4321",
    { name: "Brightside 401(k)", accountNumberLast4: "4321", owners: [{ who: spouse, percent: 1 }] },
    { category: "retirement" },
  );
  const rule = recordOf("sr-1", "Schwab Brokerage", { accountId: { ref: "record", target: "account", id: "acct-brk" }, annualAmount: 6000 }, { accountId: "acct-brk" });
  const book = () => hendricksBook({ account: [brokerage, laura401k], savings_rule: [rule] });
  const from = (rowId: string, ...columns: string[]) => columns.map((c) => cell("savings", rowId, c));

  it("a filled row is a new rule into a 401(k) the fact finder lists — it waits for that account's line", () => {
    const acme = rowOf("r401", { accountName: "Acme 401(k)", owner: "Client", accountType: "401(k)" });
    const row = rowOf("s1", {
      account: "Acme 401(k)", contribution: "Fixed $ amount", annualAmount: 23000, rothPercent: 25, employerMatch: 50, matchUpTo: 6,
      startYear: 2026, endYear: 2045, annualIncrease: 2,
    });
    expect(place(SAVINGS_MAP, [row], book(), { retirement: [acme] })).toEqual([
      {
        lineId: "s1/savings_rule", sectionId: "savings", rowId: "s1", target: "savings_rule", recordId: null,
        label: "Savings — Acme 401(k)",
        fields: [
          { key: "accountId", value: { ref: "line", target: "account", lineId: "r401/account" }, from: from("s1", "account") },
          { key: "annualAmount", value: 23000, from: from("s1", "annualAmount", "contribution"), with: { contributeMax: false, annualPercent: null } },
          { key: "rothPercent", value: 0.25, from: from("s1", "rothPercent") },
          { key: "employerMatchPct", value: 0.5, from: from("s1", "employerMatch"), with: { employerMatchAmount: null } },
          { key: "employerMatchCap", value: 0.06, from: from("s1", "matchUpTo"), with: { employerMatchAmount: null } },
          { key: "start", value: 2026, from: from("s1", "startYear") },
          { key: "end", value: 2045, from: from("s1", "endYear") },
          { key: "growthRate", value: 0.02, from: from("s1", "annualIncrease"), with: { growthSource: "custom" } },
        ],
        warnings: [],
        dependsOn: ["r401/account"],
      },
    ]);
  });

  it("IRS maximum saves the IRS limit; an amount or % beside it isn't saved; the co-client's 401(k) stops at the co-client's retirement", () => {
    const row = rowOf("s1", { account: "Brightside 401(k)", contribution: "IRS maximum", annualAmount: 23000, percentOfSalary: 6 });
    const [draft] = place(SAVINGS_MAP, [row], book());
    expect(draft.fields).toEqual([
      { key: "accountId", value: { ref: "record", target: "account", id: "acct-401" }, from: from("s1", "account") },
      { key: "contributeMax", value: true, from: from("s1", "contribution"), with: { annualPercent: null } },
      { key: "start", value: 2026, from: [] },
      { key: "end", value: { yearRef: "spouse_retirement" }, from: [] },
    ]);
    expect(draft.warnings).toEqual(['Annual $ isn\'t saved: Contribution is "IRS maximum".', '% of salary isn\'t saved: Contribution is "IRS maximum".']);
    expect(draft.label).toBe("Savings — Brightside 401(k) ··4321");
    expect(draft.dependsOn).toBeUndefined();
  });

  it("% of salary saves the percent; a typed amount beside it isn't saved", () => {
    const row = rowOf("s1", { account: "Brightside 401(k)", contribution: "% of salary", percentOfSalary: 6, annualAmount: 5000 });
    const [draft] = place(SAVINGS_MAP, [row], book());
    expect(draft.fields[1]).toEqual({ key: "annualPercent", value: 0.06, from: from("s1", "percentOfSalary", "contribution"), with: { contributeMax: false } });
    expect(draft.warnings).toEqual(['Annual $ isn\'t saved: Contribution is "% of salary".']);
  });

  it("with no Contribution, whichever of Annual $ and % of salary is filled is placed — both filled is blocked", () => {
    const drafts = place(
      SAVINGS_MAP,
      [
        rowOf("s1", { account: "Schwab Brokerage", annualAmount: 6000 }),
        rowOf("s2", { account: "Brightside 401(k)", percentOfSalary: 6 }),
        rowOf("s3", { account: "Brightside 401(k)", annualAmount: 6000, percentOfSalary: 6 }),
      ],
      book(),
    );
    expect(drafts[0].fields[1]).toEqual({ key: "annualAmount", value: 6000, from: from("s1", "annualAmount"), with: { contributeMax: false, annualPercent: null } });
    expect(drafts[1].fields[1]).toEqual({ key: "annualPercent", value: 0.06, from: from("s2", "percentOfSalary"), with: { contributeMax: false } });
    expect(drafts[2].blocked).toEqual({
      reason: 'Both "Annual $" and "% of salary" are filled — pick a Contribution.', cell: cell("savings", "s3", "contribution"),
    });
  });

  it("a new rule stops at its account's owner's retirement: the fact finder's Owner first, else the owners on record", () => {
    const sections = {
      retirement: [
        rowOf("r2", { accountName: "Laura Roth IRA", owner: "Co-client" }),
        rowOf("r3", { accountName: "Brightside 401(k)", owner: "Client" }, { link: linkedTo("acct-401") }),
      ],
      edu: [rowOf("e1", { accountName: "Emma 529", owner: "Co-client" })],
    };
    const drafts = place(
      SAVINGS_MAP,
      [
        rowOf("s1", { account: "Laura Roth IRA", annualAmount: 7000 }),
        rowOf("s2", { account: "Schwab Brokerage", annualAmount: 6000 }),
        rowOf("s3", { account: "Brightside 401(k)", annualAmount: 20000 }),
        rowOf("s4", { account: "Emma 529", annualAmount: 3000 }),
      ],
      book(),
      sections,
    );
    expect(drafts.map((d) => d.fields.find((f) => f.key === "end")?.value)).toEqual([
      { yearRef: "spouse_retirement" }, // the fact finder's Co-client account
      { yearRef: "client_retirement" }, // joint on record
      { yearRef: "client_retirement" }, // the fact finder says Client, whatever the plan says
      { yearRef: "client_retirement" }, // a 529's owner isn't saved — it has none
    ]);
  });

  it("a Start or End year that didn't read gets no default — validation asks for it", () => {
    const row = rowOf("s1", { account: "Brightside 401(k)", contribution: "IRS maximum" });
    const [draft] = place(SAVINGS_MAP, [row], book(), {}, ["s1:startYear", "s1:endYear"]);
    expect(draft.fields.map((f) => f.key)).toEqual(["accountId", "contributeMax"]);
  });

  it("a rule on record: its link names it; only the filled cells, no default years", () => {
    const row = rowOf("s1", { account: "Schwab Brokerage", annualAmount: 7500 }, { link: linkedTo("sr-1") });
    const [draft] = place(SAVINGS_MAP, [row], book());
    expect(draft).toMatchObject({ recordId: "sr-1", label: "Savings — Schwab Brokerage" });
    expect(draft.fields.map((f) => f.key)).toEqual(["accountId", "annualAmount"]);
  });

  it("a link to a record not in the book never updates it", () => {
    const row = rowOf("s1", { account: "Schwab Brokerage", annualAmount: 7500 }, { link: linkedTo("sr-of-another-client") });
    expect(place(SAVINGS_MAP, [row], book())[0].recordId).toBeNull();
  });

  it("an account that isn't found, or that two match, blocks the line on the Account cell", () => {
    const drafts = place(
      SAVINGS_MAP,
      [rowOf("s1", { account: "Vanguard IRA", annualAmount: 7000 }), rowOf("s2", { account: "Brokerage", annualAmount: 5000 })],
      book(),
      { taxable: [rowOf("t1", { accountName: "Brokerage" }), rowOf("t2", { accountName: "Brokerage" })] },
    );
    expect(drafts.map((d) => [d.label, d.blocked])).toEqual([
      ["Savings — Vanguard IRA", { reason: 'No account named "Vanguard IRA" in this fact finder or on the plan.', cell: cell("savings", "s1", "account") }],
      ["Savings — Brokerage", { reason: 'Two accounts match "Brokerage" — use the name or last 4.', cell: cell("savings", "s2", "account") }],
    ]);
    expect(drafts[0].fields.some((f) => f.key === "accountId")).toBe(false);
  });

  it("a new rule with no Account is left to validation (it needs one); no Annual increase keeps the plan's 0% — no inflation default", () => {
    const [draft] = place(SAVINGS_MAP, [rowOf("s1", { annualAmount: 5000 })], book());
    expect(draft).toMatchObject({ label: "Planned savings", recordId: null });
    expect(draft.blocked).toBeUndefined();
    expect(draft.fixed).toBeUndefined();
    expect(draft.fields.map((f) => [f.key, f.value])).toEqual([
      ["annualAmount", 5000],
      ["start", 2026],
      ["end", { yearRef: "client_retirement" }],
    ]);
  });

  it("an employer flat $ clears a match % — with both filled, the % and cap aren't saved", () => {
    const row = rowOf("s1", { account: "Schwab Brokerage", employerFlat: 3000, employerMatch: 50, matchUpTo: 6 }, { link: linkedTo("sr-1") });
    const [draft] = place(SAVINGS_MAP, [row], book());
    expect(draft.fields.slice(1)).toEqual([
      { key: "employerMatchAmount", value: 3000, from: from("s1", "employerFlat"), with: { employerMatchPct: null, employerMatchCap: null } },
    ]);
    expect(draft.warnings).toEqual(["Employer match % and Match up to aren't saved: Employer flat $ is filled."]);
  });
});
