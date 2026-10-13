import { describe, expect, it } from "vitest";
import type { ChangeLine, PlacedValue, RecordRef, TargetKind } from "../../change-set";
import { lineValues, payloadFor, type Resolve } from "../payload";
import { FACT_FINDER_ONLY, TARGETS, type ValueKind } from "../targets";

const client: RecordRef = { ref: "person", role: "client" };
const spouse: RecordRef = { ref: "person", role: "spouse" };
const emma: RecordRef = { ref: "record", target: "family_member", id: "fm-emma" };
const newTrust: RecordRef = { ref: "line", target: "entity", lineId: "t1/entity" };
const trust: RecordRef = { ref: "record", target: "entity", id: "ent-1" };
const charity: RecordRef = { ref: "record", target: "external_beneficiary", id: "ext-1" };
const newHouse: RecordRef = { ref: "line", target: "account", lineId: "re1/account" };

const YEARS: Record<string, number> = { plan_start: 2026, plan_end: 2070, client_retirement: 2035, spouse_retirement: 2037 };
const resolve: Resolve = {
  id: (ref) => (ref.ref === "person" ? `fm-${ref.role}` : ref.ref === "line" ? `new:${ref.lineId}` : ref.id),
  year: (yearRef) => YEARS[yearRef],
};

describe("payloadFor", () => {
  it("passes plain values through and resolves refs in fixed / with values", () => {
    expect(
      payloadFor("income", { name: "Acme LLC income", annualAmount: 120000, growthRate: 0.03, growthSource: "custom", ownerAccountId: newHouse }, resolve),
    ).toEqual({ name: "Acme LLC income", annualAmount: 120000, growthRate: 0.03, growthSource: "custom", ownerAccountId: "new:re1/account" });
  });

  it("splits a month-year into its month and year keys", () => {
    expect(payloadFor("liability", { start: "2015-07", balanceAsOf: "2026-03", linkedPropertyId: newHouse }, resolve)).toEqual({
      startMonth: 7, startYear: 2015, balanceAsOfMonth: 3, balanceAsOfYear: 2026, linkedPropertyId: "new:re1/account",
    });
    expect(payloadFor("note_receivable", { start: "2020-06", balanceAsOf: "2026-01" }, resolve)).toEqual({
      startMonth: 6, startYear: 2020, balanceAsOfMonth: 1, balanceAsOfYear: 2026,
    });
  });

  it("writes a typed year with no milestone, and a milestone with the year it falls in", () => {
    expect(payloadFor("income", { start: 2026, end: { yearRef: "client_retirement" } }, resolve)).toEqual({
      startYear: 2026, startYearRef: null, endYear: 2035, endYearRef: "client_retirement",
    });
    expect(payloadFor("savings_rule", { start: { yearRef: "plan_start" }, end: 2040 }, resolve)).toEqual({
      startYear: 2026, startYearRef: "plan_start", endYear: 2040, endYearRef: null,
    });
  });

  it("writes a 529's beneficiary and grantor as a family member id or a name — never both", () => {
    expect(payloadFor("account", { beneficiary: emma, grantor: "Grandma Jo" }, resolve)).toEqual({
      beneficiaryFamilyMemberId: "fm-emma", beneficiaryName: null, grantorFamilyMemberId: null, grantorName: "Grandma Jo",
    });
    expect(payloadFor("account", { grantor: client }, resolve)).toEqual({ grantorFamilyMemberId: "fm-client", grantorName: null });
  });

  it("writes owners in each route's shape", () => {
    const owners: PlacedValue = [{ who: client, percent: 0.6 }, { who: trust, percent: 0.4 }];
    const kinded = [
      { kind: "family_member", familyMemberId: "fm-client", percent: 0.6 },
      { kind: "entity", entityId: "ent-1", percent: 0.4 },
    ];
    expect(payloadFor("account", { owners }, resolve)).toEqual({ owners: kinded });
    expect(payloadFor("business_account", { owners }, resolve)).toEqual({ owners: kinded });
    expect(payloadFor("liability", { owners }, resolve)).toEqual({ owners: kinded });
    expect(payloadFor("note_receivable", { owners: [{ who: spouse, percent: 0.5 }, { who: charity, percent: 0.25 }, { who: newTrust, percent: 0.25 }] }, resolve)).toEqual({
      owners: [
        { familyMemberId: "fm-spouse", percent: 0.5 },
        { externalBeneficiaryId: "ext-1", percent: 0.25 },
        { entityId: "new:t1/entity", percent: 0.25 },
      ],
    });
  });

  it("writes a life policy's owner as the route's ownerRef", () => {
    expect(payloadFor("life_insurance_policy", { ownerRef: "joint" }, resolve)).toEqual({ ownerRef: { kind: "joint" } });
    expect(payloadFor("life_insurance_policy", { ownerRef: spouse }, resolve)).toEqual({ ownerRef: { kind: "family", id: "fm-spouse" } });
    expect(payloadFor("life_insurance_policy", { ownerRef: newTrust }, resolve)).toEqual({ ownerRef: { kind: "entity", id: "new:t1/entity" } });
    expect(payloadFor("life_insurance_policy", { ownerRef: charity }, resolve)).toEqual({ ownerRef: { kind: "external", id: "ext-1" } });
  });

  it("writes a designation set as the route's rows — the client and co-client by household role", () => {
    const beneficiaries: PlacedValue = [
      { tier: "primary", who: spouse, percentage: 100 },
      { tier: "contingent", who: emma, percentage: 50 },
      { tier: "contingent", who: newTrust, percentage: 25 },
      { tier: "contingent", who: charity, percentage: 25 },
    ];
    const rows = [
      { tier: "primary", percentage: 100, householdRole: "spouse", sortOrder: 0 },
      { tier: "contingent", percentage: 50, familyMemberId: "fm-emma", sortOrder: 1 },
      { tier: "contingent", percentage: 25, entityIdRef: "new:t1/entity", sortOrder: 2 },
      { tier: "contingent", percentage: 25, externalBeneficiaryId: "ext-1", sortOrder: 3 },
    ];
    for (const target of ["account_beneficiary_designation", "life_insurance_policy_beneficiary", "trust_beneficiary_designation"] as const) {
      expect(payloadFor(target, { beneficiaries }, resolve)).toEqual({ beneficiaries: rows });
    }
  });

  it("writes will recipients by kind — a household person is the other principal (\"spouse\", no id)", () => {
    const recipients: PlacedValue = [
      { who: spouse, percentage: 50 },
      { who: emma, percentage: 30 },
      { who: trust, percentage: 10 },
      { who: charity, percentage: 10 },
    ];
    const rows = [
      { recipientKind: "spouse", recipientId: null, percentage: 50, sortOrder: 0 },
      { recipientKind: "family_member", recipientId: "fm-emma", percentage: 30, sortOrder: 1 },
      { recipientKind: "entity", recipientId: "ent-1", percentage: 10, sortOrder: 2 },
      { recipientKind: "external_beneficiary", recipientId: "ext-1", percentage: 10, sortOrder: 3 },
    ];
    expect(payloadFor("will_bequest", { recipients }, resolve)).toEqual({ recipients: rows });
    expect(payloadFor("will_residuary_recipient", { recipients }, resolve)).toEqual({ recipients: rows });
    expect(payloadFor("will_bequest", { recipients: [{ who: client, percentage: 100 }] }, resolve)).toEqual({
      recipients: [{ recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 }],
    });
  });

  it("writes a gift's one recipient under the key its record kind names, and clears the other two", () => {
    expect(payloadFor("gift", { recipient: newTrust }, resolve)).toEqual({
      recipientFamilyMemberId: null, recipientEntityId: "new:t1/entity", recipientExternalBeneficiaryId: null,
    });
    expect(payloadFor("gift", { recipient: emma }, resolve)).toEqual({
      recipientFamilyMemberId: "fm-emma", recipientEntityId: null, recipientExternalBeneficiaryId: null,
    });
    expect(payloadFor("gift", { recipient: charity }, resolve)).toEqual({
      recipientFamilyMemberId: null, recipientEntityId: null, recipientExternalBeneficiaryId: "ext-1",
    });
  });

  it('saves a trust grantor of "Someone else" as null', () => {
    expect(payloadFor("entity", { grantor: "none" }, resolve)).toEqual({ grantor: null });
    expect(payloadFor("entity", { grantor: "spouse" }, resolve)).toEqual({ grantor: "spouse" });
  });

  it("gives each living item the id the route requires", () => {
    expect(
      payloadFor("expense", { livingItems: [{ name: "Groceries", amount: 800, frequency: "monthly" }, { name: "Travel", amount: 5000, frequency: "annual" }] }, resolve),
    ).toEqual({
      livingItems: [
        { id: "item-1", name: "Groceries", amount: 800, frequency: "monthly" },
        { id: "item-2", name: "Travel", amount: 5000, frequency: "annual" },
      ],
    });
  });

  it("leaves out what Plan 4 writes through other writers (employer, holdings)", () => {
    expect(payloadFor("client_household", { firstName: "Mark", employer: "Acme", spouseEmployer: "Globex" }, resolve)).toEqual({ firstName: "Mark" });
    const holdings: PlacedValue = [{ ticker: "VTI", name: null, shares: 10, price: 250, marketValue: 2500, costBasis: null }];
    expect(payloadFor("account", { name: "Brokerage", holdings }, resolve)).toEqual({ name: "Brokerage" });
  });

  it("expands every fact-finder-only key into exactly the payload keys the catalog lists", () => {
    const sample: Partial<Record<ValueKind, PlacedValue>> = {
      monthYear: "2026-03",
      timing: { yearRef: "plan_end" },
      personOrName: "Grandma Jo",
      ref: emma,
      text: "Acme",
      holdings: [],
      beneficiaries: [{ tier: "primary", who: spouse, percentage: 50 }, { tier: "primary", who: emma, percentage: 25 }, { tier: "primary", who: trust, percentage: 15 }, { tier: "primary", who: charity, percentage: 10 }],
      recipients: [{ who: spouse, percentage: 50 }, { who: emma, percentage: 50 }],
    };
    for (const [path, { expandsTo }] of Object.entries(FACT_FINDER_ONLY)) {
      const [target, key] = path.split(".") as [TargetKind, string];
      const value = sample[TARGETS[target].fields[key].kind];
      if (value === undefined) throw new Error(`no sample for ${path}`);
      const body = payloadFor(target, { [key]: value }, resolve);
      // A set travels under its own key; its rows carry the expanded keys.
      const rows = body[key];
      const keys = Array.isArray(rows) ? [...new Set(rows.flatMap((row) => Object.keys(row as object)))] : Object.keys(body);
      expect(keys.sort(), path).toEqual([...expandsTo].sort());
    }
  });
});

describe("lineValues", () => {
  const line = (over: Partial<ChangeLine>): ChangeLine => ({
    id: "r1/income", page: "income", sectionId: "salary", rowId: "r1", target: "income", action: "create", recordId: null,
    label: "Salary — Acme", warnings: [],
    fixed: { type: "salary", owner: "client", name: "Salary — Acme" },
    fields: [
      { key: "annualAmount", label: "Annual amount", next: 150000, shown: { next: "$150,000" }, ticked: true, from: [] },
      { key: "growthRate", label: "Annual increase", next: 0.03, shown: { next: "3%" }, ticked: true, from: [], with: { growthSource: "custom" } },
      { key: "name", label: "Name", next: "Acme salary", shown: { next: "Acme salary" }, ticked: false, from: [] },
    ],
    ...over,
  });

  it("a Create writes its fixed values, every field and each field's companions", () => {
    expect(lineValues(line({}))).toEqual({
      type: "salary", owner: "client", name: "Acme salary", annualAmount: 150000, growthRate: 0.03, growthSource: "custom",
    });
  });

  it("an Update writes only its fields — fixed values are create-only", () => {
    expect(lineValues(line({ action: "update", recordId: "inc-1" }))).toEqual({
      name: "Acme salary", annualAmount: 150000, growthRate: 0.03, growthSource: "custom",
    });
  });

  it("with ticks, writes only the ticked fields (and their companions); an unlisted field keeps its default tick", () => {
    expect(lineValues(line({ action: "update", recordId: "inc-1" }), { annualAmount: true, growthRate: false })).toEqual({ annualAmount: 150000 });
    expect(lineValues(line({ action: "update", recordId: "inc-1" }), { growthRate: true })).toEqual({
      annualAmount: 150000, growthRate: 0.03, growthSource: "custom",
    });
  });
});
