// src/lib/fact-finder/placement/map/__tests__/real-estate-debts.test.ts
import { describe, expect, it } from "vitest";
import { findSection } from "../../../schema";
import type { FFRow } from "../../../types";
import { bookWith, contextOf, hendricksBook, linkedTo, recordOf, rowOf, stateWith } from "../../__tests__/fixtures";
import { diffDrafts } from "../../diff";
import type { RecordBook, TargetDraft } from "../../types";
import { BUSINESS_MAP, LIAB_MAP, REALESTATE_MAP } from "../real-estate-debts";
import type { SectionMap } from "../types";

const client = { ref: "person", role: "client" } as const;
const spouse = { ref: "person", role: "spouse" } as const;
const joint = [{ who: client, percent: 0.5 }, { who: spouse, percent: 0.5 }];
const at = (sectionId: string, rowId: string, columnId: string) => ({ sectionId, rowId, columnId });
const houseLine = { ref: "line", target: "account", lineId: "re1/account" } as const;

function place(map: SectionMap, rows: FFRow[], opts: { book?: RecordBook; extra?: Record<string, FFRow[]>; asOf?: string } = {}) {
  const { ctx } = contextOf(stateWith({ [map.sectionId]: rows, ...opts.extra }), opts.book ?? hendricksBook(), { asOf: opts.asOf ?? null });
  return map.place(rows, ctx);
}
const keys = (draft: TargetDraft) => draft.fields.map((f) => f.key);
const fieldOf = (draft: TargetDraft, key: string) => draft.fields.find((f) => f.key === key);

const PROPERTY = { category: "real_estate", subType: "primary_residence", parentAccountId: null, isDefaultChecking: false };
const BUSINESS = { category: "business", subType: "llc", parentAccountId: null, isDefaultChecking: false };
const house = recordOf("a-house", "Main St House", { name: "Main St House", propertyAddress: "12 Main St" }, PROPERTY);
const acme = recordOf("b-acme", "Acme LLC", { name: "Acme LLC" }, BUSINESS);
const mortgage = recordOf(
  "l-mtg", "Chase Mortgage",
  { name: "Chase Mortgage", balance: 310000, balanceAsOf: "2025-12", start: "2015-07", termMonths: 360 },
  { parentAccountId: null },
);
const trusts = { trusts: [rowOf("tr1", { trustName: "Hendricks ILIT", trustType: "ILIT" })] };

const houseRow = rowOf("re1", {
  propertyName: "Main St House", propertyType: "Primary residence", currentValue: 850000, costBasis: 400000, owner: "Joint",
  jointTitling: "JTWROS", address: "12 Main St, Springfield", annualPropertyTax: 9200, mortgageName: "Chase Mortgage",
});
const loanRow = rowOf("l1", {
  loanName: "Chase Mortgage", type: "Mortgage", owner: "Joint", balance: 310000, balanceAsOf: "2026-03", interestRate: 6.5,
  monthlyPI: 1850, monthlyEscrow: 450, loanStart: "2015-07", termYears: 30, matures: "2045-07", interestDeductible: "Yes",
  propertyName: "Main St House",
});
const ESCROW_NOTE = "Chase Mortgage: escrow of $450 a month for property tax and insurance (not split between them).";

describe("placements", () => {
  it.each([REALESTATE_MAP, BUSINESS_MAP, LIAB_MAP])("$sectionId places every column exactly once", (map) => {
    expect(Object.keys(map.placements).sort()).toEqual(findSection(map.sectionId)!.columns.map((c) => c.id).sort());
  });

  it("a property's mortgage link is saved on the loan; escrow is a plan note; business income and expense are their own records", () => {
    expect(REALESTATE_MAP.placements.mortgageName).toEqual({ to: "liability.linkedPropertyId" });
    expect(LIAB_MAP.placements.monthlyEscrow).toEqual({ to: "plan_observation.body" });
    expect(BUSINESS_MAP.placements.annualIncome).toEqual({ to: "income.annualAmount" });
    expect(BUSINESS_MAP.placements.annualExpense).toEqual({ to: "expense.annualAmount" });
  });
});

describe("a new property or loan with a blank Owner", () => {
  const property = rowOf("re-1", { propertyName: "Main house" });
  const loan = rowOf("liab-1", { loanName: "Chase Visa" });

  it("is blocked on its Owner cell when there's a co-client", () => {
    expect(place(REALESTATE_MAP, [property])[0].blocked).toEqual({
      reason: "Owner: pick who owns it.", cell: { sectionId: "realestate", rowId: "re-1", columnId: "owner" },
    });
    expect(place(LIAB_MAP, [loan])[0].blocked).toEqual({
      reason: "Owner: pick who owns it.", cell: { sectionId: "liab", rowId: "liab-1", columnId: "owner" },
    });
  });

  it("is the client's alone on a household with no co-client", () => {
    const book = bookWith({}, { people: { client: "fm-client", spouse: null } });
    for (const [map, row] of [[REALESTATE_MAP, property], [LIAB_MAP, loan]] as const) {
      const [draft] = place(map, [row], { book });
      expect([draft.blocked, draft.fields.find((f) => f.key === "owners")?.value]).toEqual([undefined, [{ who: { ref: "person", role: "client" }, percent: 1 }]]);
    }
  });
});

describe("REALESTATE_MAP", () => {
  it("a property is a real estate account — cost basis as its basis, a Joint owner with its titling", () => {
    const cell = (columnId: string) => [at("realestate", "re1", columnId)];
    expect(place(REALESTATE_MAP, [houseRow], { extra: { liab: [loanRow] } })).toEqual([
      {
        lineId: "re1/account",
        sectionId: "realestate",
        rowId: "re1",
        target: "account",
        recordId: null,
        label: "Main St House",
        fixed: { category: "real_estate" },
        fields: [
          { key: "name", value: "Main St House", from: cell("propertyName") },
          { key: "subType", value: "primary_residence", from: cell("propertyType") },
          { key: "value", value: 850000, from: cell("currentValue") },
          { key: "basis", value: 400000, from: cell("costBasis") },
          { key: "propertyAddress", value: "12 Main St, Springfield", from: cell("address") },
          { key: "annualPropertyTax", value: 9200, from: cell("annualPropertyTax") },
          { key: "owners", value: joint, from: cell("owner") },
          { key: "titlingType", value: "jtwros", from: cell("jointTitling") },
        ],
        warnings: [],
      },
    ]);
  });

  it("a blank cell makes no field; the row's confirmed link picks the record, a record not in the book never", () => {
    const row = rowOf("re1", { currentValue: 900000 }, { link: linkedTo("a-house") });
    const [linked] = place(REALESTATE_MAP, [row], { book: hendricksBook({ account: [house] }) });
    expect([linked.recordId, linked.label, keys(linked)]).toEqual(["a-house", "Main St House", ["value"]]);

    const [stranger] = place(REALESTATE_MAP, [{ ...row, link: linkedTo("a-of-another-client") }]);
    expect(stranger.recordId).toBeNull();
  });

  it("a trust-owned property names the trust", () => {
    const row = rowOf("re1", { propertyName: "Lake Cabin", owner: "Trust / entity", ownerEntity: "Hendricks ILIT" });
    const [draft] = place(REALESTATE_MAP, [row], { extra: trusts });
    expect(fieldOf(draft, "owners")).toEqual({
      key: "owners",
      value: [{ who: { ref: "line", target: "entity", lineId: "tr1/entity" }, percent: 1 }],
      from: [at("realestate", "re1", "owner"), at("realestate", "re1", "ownerEntity")],
    });
    expect(draft.dependsOn).toEqual(["tr1/entity"]);
  });

  it("joint titling is saved only for a Joint owner", () => {
    const [draft] = place(REALESTATE_MAP, [rowOf("re1", { propertyName: "Lake Cabin", owner: "Client", jointTitling: "JTWROS" })]);
    expect(keys(draft)).toEqual(["name", "owners"]);
    expect(draft.warnings).toEqual(["Joint titling is saved only when the owner is Joint."]);
  });

  it("a property the plan holds through a business keeps the business's ownership", () => {
    const held = recordOf("a-shop", "Shop Building", { name: "Shop Building" }, { ...PROPERTY, parentAccountId: "b-acme" });
    const book = hendricksBook({ account: [held], business_account: [acme] });
    const [owned] = place(REALESTATE_MAP, [rowOf("re1", { propertyName: "Shop Building", owner: "Client" }, { link: linkedTo("a-shop") })], { book });
    expect(keys(owned)).toEqual(["name"]);
    expect(owned.warnings).toEqual(["This property is owned through Acme LLC."]);

    const [blank] = place(REALESTATE_MAP, [rowOf("re1", { currentValue: 500000 }, { link: linkedTo("a-shop") })], { book });
    expect(blank.warnings).toEqual([]);
  });

  it("Mortgage on it places nothing here when a Liabilities row stands for the loan; a name that matches no loan says so", () => {
    const drafts = place(REALESTATE_MAP, [houseRow], { extra: { liab: [loanRow] } });
    expect(drafts.map((d) => d.lineId)).toEqual(["re1/account"]);
    expect(drafts[0].warnings).toEqual([]);
    expect(drafts[0].dependsOn).toBeUndefined();

    const nowhere = place(REALESTATE_MAP, [houseRow]);
    expect(nowhere.map((d) => d.lineId)).toEqual(["re1/account"]);
    expect(nowhere[0].warnings).toEqual(['Mortgage on it: No loan named "Chase Mortgage" in this fact finder or on the plan.']);
  });

  describe("Mortgage on it naming a loan only on the plan", () => {
    const loanLink = (row: FFRow, value: unknown): TargetDraft => ({
      lineId: `${row.id}/liability`,
      sectionId: "realestate",
      rowId: row.id,
      target: "liability",
      recordId: "l-mtg",
      label: "Chase Mortgage",
      fields: [{ key: "linkedPropertyId", value: value as TargetDraft["fields"][number]["value"], from: [at("realestate", row.id, "mortgageName")] }],
      warnings: [],
      ...(typeof value === "object" && value !== null && (value as { ref?: string }).ref === "line" ? { dependsOn: [`${row.id}/account`] } : {}),
    });

    it("a new house: a second line links the loan on record to it, depending on the house's line", () => {
      const drafts = place(REALESTATE_MAP, [houseRow], { book: hendricksBook({ liability: [mortgage] }) });
      expect(drafts.map((d) => d.lineId)).toEqual(["re1/account", "re1/liability"]);
      expect(drafts[0].warnings).toEqual([]);
      expect(drafts[1]).toEqual(loanLink(houseRow, houseLine));
    });

    it("a house on record already linked to that loan: the loan's line is \"No changes\"", () => {
      const linkedLoan = { ...mortgage, values: { ...mortgage.values, linkedPropertyId: { ref: "record", target: "account", id: "a-house" } } } as typeof mortgage;
      const book = hendricksBook({ liability: [linkedLoan], account: [house] });
      const row = { ...houseRow, link: linkedTo("a-house") };
      const drafts = place(REALESTATE_MAP, [row], { book });
      expect(drafts[1]).toEqual(loanLink(row, { ref: "record", target: "account", id: "a-house" }));
      expect(diffDrafts(drafts, book).map((l) => [l.id, l.action])).toEqual([
        ["re1/account", "update"],
        ["re1/liability", "none"],
      ]);

      // Linked to another property on record: the loan's line moves it.
      const cabin = recordOf("a-cabin", "Lake Cabin", { name: "Lake Cabin" }, PROPERTY);
      const elsewhere = hendricksBook({ liability: [{ ...linkedLoan, values: { ...linkedLoan.values, linkedPropertyId: { ref: "record", target: "account", id: "a-cabin" } } }], account: [house, cabin] });
      const moved = diffDrafts(place(REALESTATE_MAP, [row], { book: elsewhere }), elsewhere)[1];
      expect([moved.action, moved.fields.map((f) => [f.key, f.shown])]).toEqual([
        "update",
        [["linkedPropertyId", { onRecord: "Lake Cabin", next: "Main St House" }]],
      ]);
    });

    it("two properties naming one loan on record: both links are blocked", () => {
      const cabinRow = rowOf("re2", { propertyName: "Lake Cabin", owner: "Client", mortgageName: "Chase Mortgage" });
      const drafts = place(REALESTATE_MAP, [houseRow, cabinRow], { book: hendricksBook({ liability: [mortgage] }) });
      expect(drafts.map((d) => [d.lineId, d.blocked])).toEqual([
        ["re1/account", undefined],
        ["re1/liability", { reason: 'Two properties name "Chase Mortgage" as their mortgage — keep it on one.', cell: at("realestate", "re1", "mortgageName") }],
        ["re2/account", undefined],
        ["re2/liability", { reason: 'Two properties name "Chase Mortgage" as their mortgage — keep it on one.', cell: at("realestate", "re2", "mortgageName") }],
      ]);
    });
  });
});

describe("BUSINESS_MAP", () => {
  const acmeRow = rowOf("b1", {
    businessName: "Acme LLC", businessType: "LLC", currentValue: 900000, costBasis: 100000, ownersAndPercent: "Mark 60%, Hendricks ILIT 40%",
    taxTreatment: "QBI (pass-through)", distributionPercent: 40, annualIncome: 250000, annualExpense: 60000,
  });
  const businessLine = { ref: "line", target: "business_account", lineId: "b1/business_account" } as const;

  it("a new business: its account, and the income and expense it owns", () => {
    const cell = (columnId: string) => [at("business", "b1", columnId)];
    expect(place(BUSINESS_MAP, [acmeRow], { extra: trusts })).toEqual([
      {
        lineId: "b1/business_account",
        sectionId: "business",
        rowId: "b1",
        target: "business_account",
        recordId: null,
        label: "Acme LLC",
        fixed: { category: "business" },
        fields: [
          { key: "name", value: "Acme LLC", from: cell("businessName") },
          { key: "businessType", value: "llc", from: cell("businessType") },
          { key: "value", value: 900000, from: cell("currentValue") },
          { key: "basis", value: 100000, from: cell("costBasis") },
          {
            key: "owners",
            value: [{ who: client, percent: 0.6 }, { who: { ref: "line", target: "entity", lineId: "tr1/entity" }, percent: 0.4 }],
            from: cell("ownersAndPercent"),
          },
          { key: "businessTaxTreatment", value: "qbi", from: cell("taxTreatment") },
          { key: "distributionPolicyPercent", value: 0.4, from: cell("distributionPercent") },
        ],
        warnings: [],
        dependsOn: ["tr1/entity"],
      },
      {
        lineId: "b1/income",
        sectionId: "business",
        rowId: "b1",
        target: "income",
        recordId: null,
        label: "Acme LLC income",
        fixed: { type: "business", name: "Acme LLC income", ownerAccountId: businessLine, growthSource: "inflation" },
        fields: [
          { key: "annualAmount", value: 250000, from: cell("annualIncome") },
          { key: "start", value: { yearRef: "plan_start" }, from: [] },
          { key: "end", value: { yearRef: "plan_end" }, from: [] },
        ],
        warnings: [],
        dependsOn: ["b1/business_account"],
      },
      {
        lineId: "b1/expense",
        sectionId: "business",
        rowId: "b1",
        target: "expense",
        recordId: null,
        label: "Acme LLC expenses",
        fixed: { type: "other", name: "Acme LLC expenses", ownerAccountId: businessLine, growthSource: "inflation" },
        fields: [
          { key: "annualAmount", value: 60000, from: cell("annualExpense") },
          { key: "start", value: { yearRef: "plan_start" }, from: [] },
          { key: "end", value: { yearRef: "plan_end" }, from: [] },
        ],
        warnings: [],
        dependsOn: ["b1/business_account"],
      },
    ]);
  });

  it("no Annual income or expense, no income or expense line", () => {
    const drafts = place(BUSINESS_MAP, [rowOf("b1", { businessName: "Acme LLC", ownersAndPercent: "Mark 100%" })]);
    expect(drafts.map((d) => d.target)).toEqual(["business_account"]);
  });

  it("a new business with no owners blocks; one on record keeps its owners", () => {
    const [fresh] = place(BUSINESS_MAP, [rowOf("b1", { businessName: "Acme LLC", currentValue: 900000 })]);
    expect(fresh.blocked).toEqual({
      reason: 'Name the owners and their shares, like "Mark 60%, Laura 40%".',
      cell: at("business", "b1", "ownersAndPercent"),
    });

    const [onRecord] = place(BUSINESS_MAP, [rowOf("b1", { currentValue: 950000 }, { link: linkedTo("b-acme") })], {
      book: hendricksBook({ business_account: [acme] }),
    });
    expect([onRecord.recordId, onRecord.label, keys(onRecord), onRecord.blocked]).toEqual(["b-acme", "Acme LLC", ["value"], undefined]);
  });

  it("owners who can't be found, or shares that don't add up, block on the cell", () => {
    const blockedBy = (ownersAndPercent: string) =>
      place(BUSINESS_MAP, [rowOf("b1", { businessName: "Acme LLC", ownersAndPercent })])[0].blocked;
    expect(blockedBy("Mark 60%, Laura 30%")).toEqual({ reason: "Shares add up to 90%, not 100%.", cell: at("business", "b1", "ownersAndPercent") });
    expect(blockedBy("Mark 50%, Bob 50%")?.reason).toBe('No one named "Bob" in this fact finder or on the plan.');
    expect(fieldOf(place(BUSINESS_MAP, [rowOf("b1", { ownersAndPercent: "Mark and Laura" })])[0], "owners")?.value).toEqual(joint);
  });

  it("a business on record updates the income and expense it owns (by ownerAccountId), not another business's", () => {
    const book = hendricksBook({
      business_account: [acme],
      income: [
        recordOf("inc-other", "Bakery income", { annualAmount: 50000 }, { type: "business", owner: "client", ownerAccountId: "b-other" }),
        recordOf("inc-acme", "Acme draws", { annualAmount: 240000 }, { type: "business", owner: "client", ownerAccountId: "b-acme" }),
      ],
      expense: [recordOf("exp-acme", "Acme overhead", { annualAmount: 55000 }, { type: "other", livingSlot: null, ownerAccountId: "b-acme" })],
    });
    const [, income, expense] = place(BUSINESS_MAP, [{ ...acmeRow, link: linkedTo("b-acme") }], { book, extra: trusts });
    expect(income).toEqual({
      lineId: "b1/income",
      sectionId: "business",
      rowId: "b1",
      target: "income",
      recordId: "inc-acme",
      label: "Acme draws",
      fields: [{ key: "annualAmount", value: 250000, from: [at("business", "b1", "annualIncome")] }],
      warnings: [],
    });
    expect([expense.recordId, keys(expense), expense.fixed]).toEqual(["exp-acme", ["annualAmount"], undefined]);
  });

  it("a business on record with no income of its own gets a new one, owned by the record", () => {
    const [, income] = place(BUSINESS_MAP, [rowOf("b1", { annualIncome: 250000 }, { link: linkedTo("b-acme") })], {
      book: hendricksBook({ business_account: [acme] }),
    });
    expect(income.fixed).toEqual({
      type: "business", name: "Acme LLC income", ownerAccountId: { ref: "record", target: "business_account", id: "b-acme" }, growthSource: "inflation",
    });
    expect(income.dependsOn).toBeUndefined();
  });

  it("two incomes on one business block — the review can't tell which one the fact finder means", () => {
    const owned = { type: "business", owner: "client", ownerAccountId: "b-acme" };
    const book = hendricksBook({
      business_account: [acme],
      income: [recordOf("inc-1", "Acme draws", {}, owned), recordOf("inc-2", "Acme rent", {}, owned)],
    });
    const [, income] = place(BUSINESS_MAP, [rowOf("b1", { annualIncome: 250000 }, { link: linkedTo("b-acme") })], { book });
    expect(income.blocked).toEqual({
      reason: "Acme LLC has 2 incomes on the plan — change them in Details.",
      cell: at("business", "b1", "annualIncome"),
    });
  });

  it("a business the plan nests in another is owned through it", () => {
    const holdco = recordOf("b-hold", "Hendricks Holdings", { name: "Hendricks Holdings" }, BUSINESS);
    const nested = recordOf("b-acme", "Acme LLC", { name: "Acme LLC" }, { ...BUSINESS, parentAccountId: "b-hold" });
    const [draft] = place(BUSINESS_MAP, [rowOf("b1", { ownersAndPercent: "Mark 100%" }, { link: linkedTo("b-acme") })], {
      book: hendricksBook({ business_account: [holdco, nested] }),
    });
    expect(keys(draft)).toEqual([]);
    expect(draft.warnings).toEqual(["This business is owned through Hendricks Holdings."]);
  });

  it("a business not in the book is never updated", () => {
    const [stranger] = place(BUSINESS_MAP, [{ ...acmeRow, link: linkedTo("b-of-another-client") }], { extra: trusts });
    expect(stranger.recordId).toBeNull();
  });
});

describe("LIAB_MAP", () => {
  it("a new loan: every column, the rate as a fraction, the property's line, and its escrow as a plan note", () => {
    const cell = (columnId: string) => [at("liab", "l1", columnId)];
    expect(place(LIAB_MAP, [loanRow], { extra: { realestate: [houseRow] } })).toEqual([
      {
        lineId: "l1/liability",
        sectionId: "liab",
        rowId: "l1",
        target: "liability",
        recordId: null,
        label: "Chase Mortgage",
        fields: [
          { key: "name", value: "Chase Mortgage", from: cell("loanName") },
          { key: "liabilityType", value: "mortgage", from: cell("type") },
          { key: "owners", value: joint, from: cell("owner") },
          { key: "balance", value: 310000, from: cell("balance") },
          { key: "balanceAsOf", value: "2026-03", from: cell("balanceAsOf") },
          { key: "interestRate", value: 0.065, from: cell("interestRate") },
          { key: "monthlyPayment", value: 1850, from: cell("monthlyPI") },
          { key: "start", value: "2015-07", from: cell("loanStart") },
          { key: "termMonths", value: 360, from: cell("termYears") },
          { key: "isInterestDeductible", value: true, from: cell("interestDeductible") },
          { key: "linkedPropertyId", value: houseLine, from: cell("propertyName") },
        ],
        warnings: [],
        dependsOn: ["re1/account"],
      },
      {
        lineId: "l1/plan_observation",
        sectionId: "liab",
        rowId: "l1",
        target: "plan_observation",
        recordId: null,
        label: "Plan note: escrow on Chase Mortgage",
        fixed: { section: "observation", audience: "advisor", source: "manual" },
        fields: [
          { key: "topic", value: "cash-flow", from: cell("monthlyEscrow") },
          { key: "body", value: ESCROW_NOTE, from: cell("monthlyEscrow") },
        ],
        warnings: [],
      },
    ]);
  });

  it("a new house and a new mortgage naming each other: the loan depends on the house, never the reverse", () => {
    const state = { realestate: [houseRow], liab: [loanRow] };
    const [property] = place(REALESTATE_MAP, [houseRow], { extra: state });
    const [loan] = place(LIAB_MAP, [loanRow], { extra: state });
    expect(property.dependsOn).toBeUndefined();
    expect([fieldOf(loan, "linkedPropertyId")?.value, loan.dependsOn]).toEqual([houseLine, ["re1/account"]]);
  });

  it("a blank Property it's on takes the one property whose Mortgage on it names this loan", () => {
    const loan = rowOf("l1", { loanName: "Chase Mortgage", balance: 300000 }, { link: linkedTo("l-mtg") });
    const book = hendricksBook({ liability: [mortgage], account: [house] });
    const auto = rowOf("l2", { loanName: "Auto loan", balance: 18000 });
    const [draft, other] = place(LIAB_MAP, [loan, auto], { book, extra: { realestate: [{ ...houseRow, link: linkedTo("a-house") }] } });
    expect(fieldOf(draft, "linkedPropertyId")).toEqual({
      key: "linkedPropertyId",
      value: { ref: "record", target: "account", id: "a-house" },
      from: [at("realestate", "re1", "mortgageName")],
    });
    expect([other.lineId, fieldOf(other, "linkedPropertyId")]).toEqual(["l2/liability", undefined]);

    const cabin = rowOf("re2", { propertyName: "Lake Cabin", mortgageName: "Chase Mortgage" });
    const [two] = place(LIAB_MAP, [loan], { book, extra: { realestate: [houseRow, cabin] } });
    expect(two.blocked).toEqual({
      reason: 'Two properties name this loan in "Mortgage on it" — say which in "Property it\'s on".',
      cell: at("liab", "l1", "propertyName"),
    });
  });

  it("Property it's on that names no property blocks on the cell; another property naming the loan is a warning", () => {
    const named = (propertyName: string) => rowOf("l1", { loanName: "Chase Mortgage", owner: "Client", propertyName });
    const [missing] = place(LIAB_MAP, [named("Lake Cabin")], { extra: { realestate: [houseRow] } });
    expect(missing.blocked).toEqual({
      reason: 'No property named "Lake Cabin" in this fact finder or on the plan.',
      cell: at("liab", "l1", "propertyName"),
    });

    const cabin = rowOf("re2", { propertyName: "Lake Cabin" });
    const [both] = place(LIAB_MAP, [named("Lake Cabin")], { extra: { realestate: [houseRow, cabin] } });
    expect(fieldOf(both, "linkedPropertyId")?.value).toEqual({ ref: "line", target: "account", lineId: "re2/account" });
    expect(both.warnings).toEqual(['"Main St House" also names this loan in "Mortgage on it" — it\'s saved on "Lake Cabin", from "Property it\'s on".']);
  });

  it("escrow: the same note on the plan is matched by its words; a different one isn't; no escrow, no note", () => {
    const note = (body: string) => recordOf("obs-1", "Plan note", { topic: "cash-flow", body });
    const noteOf = (book: RecordBook) => place(LIAB_MAP, [loanRow], { book, extra: { realestate: [houseRow] } })[1];
    expect(noteOf(hendricksBook({ plan_observation: [note(ESCROW_NOTE)] })).recordId).toBe("obs-1");
    expect(noteOf(hendricksBook({ plan_observation: [note("Chase Mortgage: escrow of $400 a month.")] })).recordId).toBeNull();

    expect(place(LIAB_MAP, [rowOf("l1", { loanName: "Chase Mortgage", monthlyEscrow: 0 })])).toHaveLength(1);
    expect(place(LIAB_MAP, [rowOf("l1", { loanName: "Chase Mortgage" })])).toHaveLength(1);
  });

  it("a blank Balance as of takes the statement month, else Date completed — only for a new or changed balance", () => {
    const asOf = (row: FFRow, book = hendricksBook(), date?: string) => fieldOf(place(LIAB_MAP, [row], { book, asOf: date })[0], "balanceAsOf");
    const fresh = { loanName: "Visa", balance: 4200 };
    expect(asOf(rowOf("l1", fresh, { statementDate: "2026-02-14" }), hendricksBook(), "2026-01-31")).toEqual({ key: "balanceAsOf", value: "2026-02", from: [] });
    expect(asOf(rowOf("l1", fresh), hendricksBook(), "2026-01-31")).toEqual({ key: "balanceAsOf", value: "2026-01", from: [] });
    expect(asOf(rowOf("l1", fresh))).toBeUndefined();

    const book = hendricksBook({ liability: [mortgage] });
    const linked = (balance: number) => rowOf("l1", { balance }, { link: linkedTo("l-mtg"), statementDate: "2026-02-14" });
    expect(asOf(linked(310000), book)).toBeUndefined();
    expect(asOf(linked(305000), book)?.value).toBe("2026-02");
  });

  it("a balance within half a cent of the record's is unchanged — no Balance as of", () => {
    const book = hendricksBook({ liability: [mortgage] });
    const draft = place(LIAB_MAP, [rowOf("l1", { balance: 310000.004 }, { link: linkedTo("l-mtg"), statementDate: "2026-02-14" })], { book })[0];
    expect(fieldOf(draft, "balanceAsOf")).toBeUndefined();
  });

  it("a Matures in the same month as the loan start is a zero-month term: blocked, not saved", () => {
    const draft = place(LIAB_MAP, [rowOf("l1", { loanName: "Chase Mortgage", owner: "Client", loanStart: "2015-07", matures: "2015-07" })], { book: hendricksBook({ liability: [mortgage] }) })[0];
    expect(draft.blocked).toEqual({ reason: "Matures is on or before the loan start — check both dates.", cell: at("liab", "l1", "matures") });
    expect(fieldOf(draft, "termMonths")).toBeUndefined();
  });

  it("Matures sets the term only when Term is blank — counted from the loan start, the one on record, or the balance's date", () => {
    // A new loan names its owner; the one on record keeps its own.
    const loan = (values: Record<string, string | number>, extra: Partial<FFRow> = {}) =>
      place(LIAB_MAP, [rowOf("l1", { loanName: "Chase Mortgage", ...(extra.link ? {} : { owner: "Client" }), ...values }, extra)], { book: hendricksBook({ liability: [mortgage] }) })[0];
    const term = (draft: TargetDraft) => fieldOf(draft, "termMonths");

    expect(term(loan({ loanStart: "2015-07", matures: "2045-07" }))).toEqual({ key: "termMonths", value: 360, from: [at("liab", "l1", "matures")] });
    expect(term(loan({ loanStart: "2015-07", termYears: 15, matures: "2045-07" }))?.value).toBe(180);

    const onRecord = loan({ matures: "2040-07" }, { link: linkedTo("l-mtg") });
    expect([keys(onRecord), term(onRecord)?.value]).toEqual([["name", "termMonths"], 300]);

    const dated = loan({ balance: 280000, balanceAsOf: "2026-03", matures: "2046-03" });
    expect([fieldOf(dated, "start"), term(dated)?.value]).toEqual([{ key: "start", value: "2026-03", from: [at("liab", "l1", "balanceAsOf")] }, 240]);
    const statement = loan({ balance: 280000, matures: "2046-03" }, { statementDate: "2026-02-14" });
    expect([fieldOf(statement, "start"), term(statement)?.value]).toEqual([{ key: "start", value: "2026-02", from: [] }, 241]);

    expect(loan({ loanStart: "2015-07", matures: "2015-01" }).blocked).toEqual({
      reason: "Matures is on or before the loan start — check both dates.",
      cell: at("liab", "l1", "matures"),
    });
  });

  it("Owner is the row's (not always the client); a loan the plan holds through a business keeps the business's ownership", () => {
    const [coClient] = place(LIAB_MAP, [rowOf("l1", { loanName: "Auto loan", owner: "Co-client" })]);
    expect(fieldOf(coClient, "owners")?.value).toEqual([{ who: spouse, percent: 1 }]);

    const businessDebt = recordOf("l-line", "Acme line of credit", { name: "Acme line of credit" }, { parentAccountId: "b-acme" });
    const [held] = place(LIAB_MAP, [rowOf("l1", { owner: "Client", balance: 20000 }, { link: linkedTo("l-line") })], {
      book: hendricksBook({ liability: [businessDebt], business_account: [acme] }),
    });
    expect(keys(held)).toEqual(["balance"]);
    expect(held.warnings).toEqual(["This loan is owned through Acme LLC."]);
  });

  it("a row linked to a loan not in the book never updates it; Interest deductible No is saved as false", () => {
    const [draft] = place(LIAB_MAP, [rowOf("l1", { loanName: "Visa", interestDeductible: "No" }, { link: linkedTo("l-of-another-client") })]);
    expect(draft.recordId).toBeNull();
    expect(fieldOf(draft, "isInterestDeductible")?.value).toBe(false);
  });
});
