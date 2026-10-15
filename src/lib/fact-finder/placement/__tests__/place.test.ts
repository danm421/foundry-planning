// src/lib/fact-finder/placement/__tests__/place.test.ts
import { describe, expect, it } from "vitest";
import type { FactFinderState, FFCell, FFRow, FFUnassignedHolding } from "../../types";
import { diffDrafts } from "../diff";
import { CASH_MAP } from "../map/accounts";
import { columnFeeding, sectionMapFor } from "../map/index";
import { placeFactFinder, type Placed } from "../place";
import type { RecordBook } from "../types";
import { validateLines } from "../validate";
import { hendricksBook, linkedTo, recordOf, rowOf, stateWith } from "./fixtures";

const NOW = new Date("2026-03-15T12:00:00Z");

/** A document value that didn't read as its column's type: the reader keeps the text, flagged. */
const unfit = (value: string, issue: FFCell["issue"] = "unparsed"): FFCell => ({ value, by: "document", confidence: 0.9, issue });
/** A value of the wrong type that carries no flag. */
const raw = (value: FFCell["value"]): FFCell => ({ value, by: "advisor", pinned: true });
const withCells = (row: FFRow, cells: Record<string, FFCell>): FFRow => ({ ...row, cells: { ...row.cells, ...cells } });

function place(sections: Record<string, FFRow[]>, book: RecordBook = hendricksBook(), more: Partial<FactFinderState> = {}, now = NOW): Placed {
  return placeFactFinder({ ...stateWith(sections), ...more }, book, now);
}
const draft = (placed: Placed, lineId: string) => placed.drafts.find((d) => d.lineId === lineId);
const keysOf = (placed: Placed, lineId: string) => draft(placed, lineId)?.fields.map((f) => f.key);

const kids = {
  family_member: [
    recordOf("fm-emma", "Emma Hendricks", { firstName: "Emma", lastName: "Hendricks" }),
    recordOf("fm-lucas", "Lucas Hendricks", { firstName: "Lucas", lastName: "Hendricks" }),
  ],
};

describe("placeFactFinder — which rows", () => {
  it("places live rows only: a removed row and a row with no values make nothing", () => {
    const placed = place(
      { cash: [rowOf("c1", { accountName: "Joint Checking" }), { id: "c2", cells: {}, sourceFileIds: [] }] },
      hendricksBook(),
      { removed: [{ sectionId: "cash", row: rowOf("c3", { accountName: "Old Savings" }), reason: "Duplicate", by: "advisor", at: "2026-03-01T00:00:00Z" }] },
    );
    expect(placed.drafts.map((d) => d.lineId)).toEqual(["c1/account"]);
  });

  it("Date completed is the 'as of' date, and the year is now's", () => {
    const placed = place(
      {
        meta: [rowOf("meta:Household", { dateCompleted: "2026-03-02" })],
        liab: [rowOf("l1", { loanName: "Car Loan", balance: 18000 })],
        income: [rowOf("i1", { incomeName: "Pension", annualAmount: 24000 })],
      },
      hendricksBook(),
      {},
      new Date("2027-01-05T12:00:00Z"),
    );
    expect(draft(placed, "l1/liability")?.fields.find((f) => f.key === "balanceAsOf")).toEqual({ key: "balanceAsOf", value: "2026-03", from: [] });
    expect(draft(placed, "i1/income")?.fields.find((f) => f.key === "start")).toEqual({ key: "start", value: 2027, from: [] });
  });

  it("a Date completed that didn't read is dropped: no 'as of' date, and nothing for the AI step", () => {
    const placed = place({
      meta: [withCells(rowOf("meta:Household", {}), { dateCompleted: unfit("sometime in March") })],
      liab: [rowOf("l1", { loanName: "Car Loan", balance: 18000 })],
    });
    expect(keysOf(placed, "l1/liability")).not.toContain("balanceAsOf");
    expect(placed.leftovers).toEqual([]);
  });
});

describe("placeFactFinder — values that don't fit their column (D5)", () => {
  const checking = rowOf("c1", { accountName: "Joint Checking", currentValue: 12500, last4: "1234", owner: "Joint" });

  it("a choice that isn't one of the options blocks the line its column feeds, at that cell", () => {
    const placed = place({ cash: [withCells(checking, { owner: unfit("Mark & Laura", "notAnOption") })] });
    expect(draft(placed, "c1/account")?.blocked).toEqual({
      reason: 'Owner: "Mark & Laura" isn\'t one of the options — pick one.',
      cell: { sectionId: "cash", rowId: "c1", columnId: "owner" },
    });
    expect(keysOf(placed, "c1/account")).toEqual(["name", "value", "accountNumberLast4"]);
    expect(placed.leftovers).toEqual([]);
  });

  it("the choice's reason replaces the one the map gave (the removed cell is the root cause)", () => {
    // The map blocks a 529 with no beneficiary.
    const placed = place({ edu: [rowOf("e1", { accountName: "Emma 529", currentValue: 30000 })] });
    expect(draft(placed, "e1/account")?.blocked?.reason).toBe("A 529 needs its beneficiary (the student).");

    const flagged = place({ edu: [withCells(rowOf("e1", { accountName: "Emma 529", currentValue: 30000 }), { owner: unfit("Grandma", "notAnOption") })] });
    expect(draft(flagged, "e1/account")?.blocked).toEqual({
      reason: 'Owner: "Grandma" isn\'t one of the options — pick one.',
      cell: { sectionId: "edu", rowId: "e1", columnId: "owner" },
    });
  });

  it("a number that didn't read goes to the AI step, and the line is placed without it", () => {
    const placed = place({ cash: [withCells(checking, { currentValue: unfit("about 1.2 million") })] });
    const account = draft(placed, "c1/account");
    expect(account?.blocked).toBeUndefined();
    expect(account?.fields.map((f) => f.key)).not.toContain("value");
    expect(placed.leftovers).toEqual([
      {
        id: "c1:currentValue",
        cell: { sectionId: "cash", rowId: "c1", columnId: "currentValue" },
        text: "about 1.2 million",
        kind: "unfit",
        topic: "investments",
        columnLabel: "Current value",
        rowLabel: "Joint Checking ··1234",
      },
    ]);
  });

  it("a value of the wrong type for its column's kind is unfit with no flag: text in a percent, check or date column, a label that isn't an option", () => {
    const placed = place({
      family: [withCells(rowOf("f1", { firstName: "Emma", lastName: "Hendricks" }), { dateOfBirth: raw("09/01/2001"), domesticPartner: raw("yes") })],
      cash: [withCells(rowOf("c1", { accountName: "Joint Checking", currentValue: 12500 }), { interestRate: raw("4.35%"), accountType: raw("Checking account") })],
    });
    expect(placed.leftovers.map(({ id, text, topic, columnLabel, rowLabel }) => ({ id, text, topic, columnLabel, rowLabel }))).toEqual([
      { id: "f1:dateOfBirth", text: "09/01/2001", topic: "general", columnLabel: "Date of birth", rowLabel: "Emma Hendricks" },
      { id: "f1:domesticPartner", text: "yes", topic: "general", columnLabel: "Domestic partner", rowLabel: "Emma Hendricks" },
      { id: "c1:interestRate", text: "4.35%", topic: "investments", columnLabel: "Interest rate %", rowLabel: "Joint Checking" },
    ]);
    expect(keysOf(placed, "f1/family_member")).toEqual(["firstName", "lastName"]);
    expect(draft(placed, "c1/account")?.blocked?.reason).toBe('Account type: "Checking account" isn\'t one of the options — pick one.');
  });

  it("an unfit Frequency on a later item row blocks the itemized list, which sits on the first item's row", () => {
    const current = recordOf("e-cur", "Current living expenses", { annualAmount: 90000, livingItems: null }, { type: "living", livingSlot: "current", ownerAccountId: null });
    const placed = place(
      {
        living_items: [
          rowOf("li1", { item: "Groceries", amount: 1200, frequency: "Monthly" }),
          withCells(rowOf("li2", { item: "Golf", amount: 300 }), { frequency: unfit("Weekly", "notAnOption") }),
        ],
      },
      hendricksBook({ expense: [current] }),
    );
    expect(placed.drafts.map((d) => d.lineId)).toEqual(["li1/expense"]);
    expect(draft(placed, "li1/expense")?.blocked).toEqual({
      reason: 'Frequency: "Weekly" isn\'t one of the options — pick one.',
      cell: { sectionId: "living_items", rowId: "li2", columnId: "frequency" },
    });
  });

  it("an unfit Owner on a later grant row blocks that row's grant: the company's account sits on its first row", () => {
    const grant = { company: "Acme Corp", grantType: "RSU", sharesGranted: 400, vestingSchedule: "25% a year over 4 years" };
    const placed = place({
      equity: [
        rowOf("g1", { ...grant, grantDate: "2024-03-01", owner: "Client" }),
        withCells(rowOf("g2", { ...grant, grantDate: "2025-03-01" }), { owner: unfit("Mark & Laura", "notAnOption") }),
      ],
    });
    expect(placed.drafts.map((d) => [d.lineId, d.blocked?.reason ?? null])).toEqual([
      ["g1/stock_option_account", null],
      ["g1/stock_option_grant", null],
      ["g2/stock_option_grant", 'Owner: "Mark & Laura" isn\'t one of the options — pick one.'],
    ]);
  });

  it("an unfit Will of blocks its row's provision with the choice's reason — not the will, which sits on Documents in Place", () => {
    const placed = place(
      {
        cash: [rowOf("c1", { accountName: "Joint Checking" })],
        bequests: [
          rowOf("b1", { willOf: "Client", gift: "Specific asset", asset: "Joint Checking", recipients: "Emma" }),
          withCells(rowOf("b2", { gift: "Specific asset", asset: "Joint Checking", recipients: "Lucas" }), { willOf: unfit("Both", "notAnOption") }),
        ],
      },
      hendricksBook(kids),
    );
    expect(draft(placed, "estate_docs:Client/will")?.blocked).toBeUndefined();
    expect(draft(placed, "b1/will_bequest")?.blocked).toBeUndefined();
    expect(draft(placed, "b2/will_bequest")?.blocked).toEqual({
      reason: 'Will of: "Both" isn\'t one of the options — pick one.',
      cell: { sectionId: "bequests", rowId: "b2", columnId: "willOf" },
    });
  });

  it("an unfit choice on a row that makes no line is never dropped silently: a notice names it", () => {
    const placed = place({ people: [withCells(rowOf("people:Co-client", {}), { retirementMonth: unfit("Juneish", "notAnOption") })] });
    expect(placed.drafts).toEqual([]);
    expect(placed.notices).toEqual(['Retirement month (Client & Co-client — Co-client): "Juneish" isn\'t one of the options — pick one, then review again.']);
  });
});

describe("placeFactFinder — an unreadable % of it never becomes a default", () => {
  const unreadable = [
    ["flagged by the reader", { value: 50, by: "document", confidence: 0.9, issue: "unparsed" } as FFCell],
    ["not a number", raw("half")],
  ] as const;
  const percentCell = (rowId: string) => ({ sectionId: "bequests", rowId, columnId: "percent" });

  it.each(unreadable)("a specific asset's %s % of it: no percentage, and validation blocks the line at that cell", (_, percent) => {
    const book = hendricksBook(kids);
    const placed = place(
      {
        taxable: [rowOf("tx-1", { accountName: "Joint Brokerage" })],
        bequests: [withCells(rowOf("b1", { willOf: "Client", gift: "Specific asset", asset: "Joint Brokerage", recipients: "Emma" }), { percent })],
      },
      book,
    );
    expect(keysOf(placed, "b1/will_bequest")).not.toContain("percentage");
    const lines = validateLines(diffDrafts(placed.drafts, book), (line, key) => columnFeeding(line.sectionId, line.target, key));
    expect(lines.find((l) => l.id === "b1/will_bequest")?.blocked).toEqual({ reason: "Needs % of it.", cell: percentCell("b1") });
  });

  it.each(unreadable)("a remaining-estate row's %s % of it is never 'all of it': the line is blocked at that cell", (_, percent) => {
    const placed = place({
      bequests: [withCells(rowOf("b2", { willOf: "Client", gift: "Remaining estate", recipients: "Lucas" }), { percent })],
    }, hendricksBook(kids));
    expect(draft(placed, "b2/will_residuary_recipient")).toMatchObject({
      fields: [],
      blocked: { reason: '"% of it" didn\'t read as a number — enter the percent, or clear it to leave all of it.', cell: percentCell("b2") },
    });
  });
});

describe("placeFactFinder — notes for the AI step", () => {
  it("notes columns and the two notes boxes become notes; a row with only a note makes no line", () => {
    const placed = place({
      living: [rowOf("living:Current", { notes: "Includes travel." })],
      expenses: [rowOf("x1", { expenseName: "Travel", annualAmount: 15000, notes: "Europe every other year." })],
      insurance_notes: [rowOf("insurance_notes:Notes", { notes: "Group life at work: 2x salary." })],
      final_notes: [rowOf("final_notes:Notes", { notes: "Laura plans to sell the lake cabin." })],
    });
    expect(placed.leftovers).toEqual([
      {
        id: "living:Current:notes", cell: { sectionId: "living", rowId: "living:Current", columnId: "notes" }, text: "Includes travel.",
        kind: "note", topic: "cash-flow", columnLabel: "Notes", rowLabel: "Living Expenses — Current",
      },
      {
        id: "x1:notes", cell: { sectionId: "expenses", rowId: "x1", columnId: "notes" }, text: "Europe every other year.",
        kind: "note", topic: "cash-flow", columnLabel: "Notes", rowLabel: "Travel",
      },
      {
        id: "insurance_notes:Notes:notes", cell: { sectionId: "insurance_notes", rowId: "insurance_notes:Notes", columnId: "notes" },
        text: "Group life at work: 2x salary.", kind: "note", topic: "insurance", columnLabel: "Notes", rowLabel: "Group / employer coverage & notes",
      },
      {
        id: "final_notes:Notes:notes", cell: { sectionId: "final_notes", rowId: "final_notes:Notes", columnId: "notes" },
        text: "Laura plans to sell the lake cabin.", kind: "note", topic: "general", columnLabel: "Notes", rowLabel: "Anything else we should know?",
      },
    ]);
    expect(placed.drafts.map((d) => d.lineId)).toEqual(["x1/expense"]);
  });
});

describe("placeFactFinder — a row linked to the other kind of account", () => {
  const business = recordOf("b-1", "Hendricks Consulting", { name: "Hendricks Consulting" }, { category: "business" });
  const checking = recordOf("a-1", "Joint Checking ··1234", { name: "Joint Checking" }, { category: "cash" });
  const IS_A_BUSINESS = 'Links to: "Hendricks Consulting" is a business on the plan, so this row can\'t update it — link it to another record, or pick New.';

  it("a Cash, Retirement or Real estate row confirmed to a business is blocked whole, replacing the map's reason", () => {
    const link = { link: linkedTo("b-1") };
    const placed = place(
      {
        cash: [rowOf("c1", { accountName: "Consulting Checking", currentValue: 9000 }, link)],
        retirement: [rowOf("r1", { accountName: "Solo 401(k)", primaryBeneficiary: "Laura" }, link)],
        // The map blocks this one for the trust it doesn't name.
        realestate: [rowOf("p1", { propertyName: "Office", owner: "Trust / entity" }, link)],
      },
      hendricksBook({ business_account: [business] }),
    );
    expect(placed.drafts.map((d) => [d.lineId, d.recordId, d.blocked])).toEqual([
      ["c1/account", null, { reason: IS_A_BUSINESS }],
      ["r1/account", null, { reason: IS_A_BUSINESS }],
      ["r1/account_beneficiary_designation", null, { reason: IS_A_BUSINESS }],
      ["p1/account", null, { reason: IS_A_BUSINESS }],
    ]);
  });

  it("a row that is linked to the wrong kind AND has an unfit choice shows the wrong-link reason (the wrong link wins)", () => {
    const placed = place(
      { cash: [withCells(rowOf("c1", { accountName: "Consulting Checking", currentValue: 9000 }, { link: linkedTo("b-1") }), { owner: unfit("Mark & Laura", "notAnOption") })] },
      hendricksBook({ business_account: [business] }),
    );
    expect(draft(placed, "c1/account")?.blocked).toEqual({ reason: IS_A_BUSINESS });
  });

  it("a Business row confirmed to an account is blocked whole, with its income and expense", () => {
    const placed = place(
      { business: [rowOf("bz1", { businessName: "Hendricks Consulting", ownersAndPercent: "Mark 100%", annualIncome: 120000, annualExpense: 30000 }, { link: linkedTo("a-1") })] },
      hendricksBook({ account: [checking] }),
    );
    const reason = 'Links to: "Joint Checking ··1234" isn\'t a business on the plan, so this row can\'t update it — link it to a business, or pick New.';
    expect(placed.drafts.map((d) => [d.lineId, d.blocked])).toEqual([
      ["bz1/business_account", { reason }],
      ["bz1/income", { reason }],
      ["bz1/expense", { reason }],
    ]);
  });

  it("an account row confirmed to an account of another category is blocked whole, naming that category", () => {
    const brokerage = recordOf("a-2", "Joint Brokerage", { name: "Joint Brokerage" }, { category: "taxable" });
    const placed = place(
      {
        realestate: [rowOf("p1", { propertyName: "Lake House", currentValue: 650000 }, { link: linkedTo("a-1") })],
        cash: [rowOf("c1", { accountName: "Joint Checking", currentValue: 9000 }, { link: linkedTo("a-2") })],
      },
      hendricksBook({ account: [checking, brokerage] }),
    );
    const otherCategory = (label: string, category: string) =>
      `Links to: "${label}" is ${category} account on the plan, so this row can't update it — link it to another record, or pick New.`;
    expect(placed.drafts.map((d) => [d.lineId, d.blocked])).toEqual([
      ["c1/account", { reason: otherCategory("Joint Brokerage", "a taxable") }],
      ["p1/account", { reason: otherCategory("Joint Checking ··1234", "a cash") }],
    ]);
  });

  it("a Real estate row confirmed to a real estate account is placed as usual", () => {
    const house = recordOf("a-3", "Lake House", { name: "Lake House" }, { category: "real_estate" });
    const placed = place(
      { realestate: [rowOf("p1", { propertyName: "Lake House", currentValue: 650000 }, { link: linkedTo("a-3") })] },
      hendricksBook({ account: [house] }),
    );
    expect(placed.drafts.map((d) => [d.lineId, d.recordId, d.blocked ?? null])).toEqual([["p1/account", "a-3", null]]);
  });

  it("a row confirmed to its own kind of record is placed as usual", () => {
    const placed = place(
      {
        cash: [rowOf("c1", { accountName: "Joint Checking", currentValue: 9000 }, { link: linkedTo("a-1") })],
        business: [rowOf("bz1", { businessName: "Hendricks Consulting", currentValue: 500000 }, { link: linkedTo("b-1") })],
      },
      hendricksBook({ account: [checking], business_account: [business] }),
    );
    expect(placed.drafts.map((d) => [d.lineId, d.recordId, d.blocked ?? null])).toEqual([
      ["c1/account", "a-1", null],
      ["bz1/business_account", "b-1", null],
    ]);
  });
});

describe("placeFactFinder — notices and map bugs", () => {
  const holding = (id: string): FFUnassignedHolding => ({
    id, ticker: "VTI", name: null, shares: 10, price: null, marketValue: null, costBasis: null, by: "document", accountHint: "…9999",
  });

  it("collects the maps' notices in order, then says how many holdings no account claims", () => {
    const placed = place(
      { estate_docs: [rowOf("estate_docs:Client", { ilit: true, idgt: true })] },
      hendricksBook(),
      { unassignedHoldings: [holding("h1"), holding("h2")] },
    );
    expect(placed.notices).toEqual([
      "Documents in Place says the client has an ILIT, but the Trusts section lists none — add it there to save it.",
      "Documents in Place says the client has an IDGT, but the Trusts section lists none — add it there to save it.",
      "2 holdings aren't assigned to an account and won't be saved.",
    ]);
    expect(place({}, hendricksBook(), { unassignedHoldings: [holding("h1")] }).notices).toEqual([
      "1 holding isn't assigned to an account and won't be saved.",
    ]);
  });

  it("two drafts with one line id throw — a map bug, not the advisor's input", () => {
    expect(() => place({ cash: [rowOf("c1", { accountName: "Checking" }), rowOf("c1", { accountName: "Savings" })] })).toThrow(
      'Two drafts share the line id "c1/account"',
    );
  });
});

describe("sectionMapFor and columnFeeding", () => {
  it("finds a section's map", () => {
    expect(sectionMapFor("cash")).toBe(CASH_MAP);
    expect(sectionMapFor("nope")).toBeUndefined();
  });

  it("names the column placed into a target's key — the first one declared when several are", () => {
    expect(columnFeeding("savings", "savings_rule", "start")).toBe("startYear");
    expect(columnFeeding("cash", "account", "owners")).toBe("owner");
    expect(columnFeeding("liab", "liability", "termMonths")).toBe("termYears");
    expect(columnFeeding("retirement", "account_beneficiary_designation", "beneficiaries")).toBe("primaryBeneficiary");
  });

  it("is undefined for a key no placement names (a mode's second key), a context or note column, or an unknown section", () => {
    expect(columnFeeding("disability", "disability_policy", "ltdBenefitPeriodYears")).toBeUndefined();
    expect(columnFeeding("living", "expense", "start")).toBeUndefined();
    expect(columnFeeding("nope", "account", "name")).toBeUndefined();
  });
});
