// src/lib/fact-finder/placement/map/__tests__/household.test.ts
import { describe, expect, it } from "vitest";
import { findSection } from "../../../schema";
import type { FFRow } from "../../../types";
import { bookWith, contextOf, hendricksBook, linkedTo, recordOf, rowOf, stateWith } from "../../__tests__/fixtures";
import type { DraftField, RecordBook } from "../../types";
import { EXTERNAL_MAP, FAMILY_MAP, HOUSEHOLD_MAP, META_MAP, PEOPLE_MAP } from "../household";
import type { SectionMap } from "../types";

const SETTINGS = recordOf("ps-1", "Tax settings", { coveredByWorkplacePlan: "auto", spouseCoveredByWorkplacePlan: "auto", residenceState: "CO" });

/** Mark and Laura on record (client "c1"), with the base case's tax settings. */
const book = (records: Parameters<typeof hendricksBook>[0] = {}) => hendricksBook({ plan_settings_tax_rates: [SETTINGS], ...records });

/** Mark on record, no co-client. */
const singleBook = bookWith(
  {
    client_household: [recordOf("c1", "Mark Hendricks", { firstName: "Mark", lastName: "Hendricks", spouseName: null, spouseLastName: null })],
    plan_settings_tax_rates: [SETTINGS],
  },
  { people: { client: "fm-client", spouse: null }, names: { client: "Mark", spouse: null } },
);

function place(map: SectionMap, rows: FFRow[], b: RecordBook = book()) {
  const { ctx, notices } = contextOf(stateWith({ [map.sectionId]: rows }), b);
  return { drafts: map.place(rows, ctx), notices };
}

/** A draft field that came from one column of one row. */
const fieldsOf = (sectionId: string, rowId: string) => (key: string, value: DraftField["value"], columnId: string): DraftField => ({
  key,
  value,
  from: [{ sectionId, rowId, columnId }],
});

const keysOf = (fields: DraftField[]) => fields.map((f) => f.key);

describe("Household page placements", () => {
  it.each([META_MAP, PEOPLE_MAP, HOUSEHOLD_MAP, FAMILY_MAP, EXTERNAL_MAP])("$sectionId places every column exactly once", (map) => {
    expect(Object.keys(map.placements)).toEqual(findSection(map.sectionId)!.columns.map((c) => c.id));
  });

  it("the page has no percent columns, so nothing becomes a fraction", () => {
    for (const id of ["meta", "people", "household", "family", "external"]) {
      expect(findSection(id)!.columns.filter((c) => c.kind === "percent")).toEqual([]);
    }
  });
});

describe("META_MAP", () => {
  it("is context only: Date completed is the runner's 'as of', and nothing is saved", () => {
    expect(Object.values(META_MAP.placements).every((p) => "context" in p)).toBe(true);
    const row = rowOf("meta:Household", { preparedFor: "The Hendricks Family", advisor: "Dan Mueller", dateCompleted: "2026-09-30" });
    expect(place(META_MAP, [row]).drafts).toEqual([]);
  });
});

describe("PEOPLE_MAP", () => {
  const clientRow = rowOf("people:Client", {
    firstName: "Mark", lastName: "Hendricks", dateOfBirth: "1968-04-12", retirementAge: 65, retirementMonth: "March",
    planToAge: 92, email: "mark@example.com", phone: "303-555-0100", mobile: "303-555-0101", coveredByWorkplacePlan: "Yes",
  });
  const coClientRow = rowOf("people:Co-client", {
    firstName: "Laura", lastName: "Hendricks", dateOfBirth: "1970-09-30", retirementAge: 63, retirementMonth: "December",
    planToAge: 95, email: "laura@example.com", phone: "303-555-0200", mobile: "303-555-0201", coveredByWorkplacePlan: "No",
  });

  it("a filled Client row updates the household and its tax settings", () => {
    const f = fieldsOf("people", "people:Client");
    expect(place(PEOPLE_MAP, [clientRow]).drafts).toEqual([
      {
        lineId: "people:Client/client_household", sectionId: "people", rowId: "people:Client", target: "client_household",
        recordId: "c1", label: "Client — Mark Hendricks",
        fields: [
          f("firstName", "Mark", "firstName"), f("lastName", "Hendricks", "lastName"), f("dateOfBirth", "1968-04-12", "dateOfBirth"),
          f("retirementAge", 65, "retirementAge"), f("retirementMonth", 3, "retirementMonth"), f("lifeExpectancy", 92, "planToAge"),
          f("email", "mark@example.com", "email"), f("phone", "303-555-0100", "phone"), f("mobile", "303-555-0101", "mobile"),
        ],
        warnings: [],
      },
      {
        lineId: "people:Client/plan_settings_tax_rates", sectionId: "people", rowId: "people:Client", target: "plan_settings_tax_rates",
        recordId: "ps-1", label: "Tax settings — Mark Hendricks",
        fields: [f("coveredByWorkplacePlan", "yes", "coveredByWorkplacePlan")],
        warnings: [],
      },
    ]);
  });

  it("a filled Co-client row goes to the co-client's keys", () => {
    const f = fieldsOf("people", "people:Co-client");
    const [household, settings] = place(PEOPLE_MAP, [coClientRow]).drafts;
    expect(household).toMatchObject({ lineId: "people:Co-client/client_household", recordId: "c1", label: "Co-client — Laura Hendricks" });
    expect(household.fields).toEqual([
      f("spouseName", "Laura", "firstName"), f("spouseLastName", "Hendricks", "lastName"), f("spouseDob", "1970-09-30", "dateOfBirth"),
      f("spouseRetirementAge", 63, "retirementAge"), f("spouseRetirementMonth", 12, "retirementMonth"), f("spouseLifeExpectancy", 95, "planToAge"),
      f("spouseEmail", "laura@example.com", "email"), f("spousePhone", "303-555-0200", "phone"), f("spouseMobile", "303-555-0201", "mobile"),
    ]);
    expect(settings).toMatchObject({ lineId: "people:Co-client/plan_settings_tax_rates", recordId: "ps-1", label: "Tax settings — Laura Hendricks" });
    expect(settings.fields).toEqual([f("spouseCoveredByWorkplacePlan", "no", "coveredByWorkplacePlan")]);
  });

  it("Review Focus 1: a blank Co-client first name on a household with a co-client makes no spouseName field", () => {
    const row = rowOf("people:Co-client", { lastName: "Hendricks", dateOfBirth: "1970-09-30" });
    const [household, ...rest] = place(PEOPLE_MAP, [row]).drafts;
    expect(keysOf(household.fields)).toEqual(["spouseLastName", "spouseDob"]);
    expect(household.blocked).toBeUndefined();
    expect(household.label).toBe("Co-client — Laura Hendricks");      // the name on record
    expect(rest).toEqual([]);                                          // no coverage given → no tax settings line
  });

  it("a Co-client row without a first name can't add a co-client to a household that has none", () => {
    const row = rowOf("people:Co-client", { dateOfBirth: "1970-09-30", coveredByWorkplacePlan: "Yes" });
    const drafts = place(PEOPLE_MAP, [row], singleBook).drafts;
    const reason = "Add the co-client's first name — it's needed to add a co-client.";
    const cell = { sectionId: "people", rowId: "people:Co-client", columnId: "firstName" };
    expect(drafts.map((d) => [d.lineId, d.blocked])).toEqual([
      ["people:Co-client/client_household", { reason, cell }],
      ["people:Co-client/plan_settings_tax_rates", { reason, cell }],
    ]);
    expect(drafts[0].label).toBe("Co-client");
  });

  it("a Co-client row with a first name adds the co-client", () => {
    const [household] = place(PEOPLE_MAP, [rowOf("people:Co-client", { firstName: "Laura", dateOfBirth: "1970-09-30" })], singleBook).drafts;
    expect(household.blocked).toBeUndefined();
    expect(household.fields.map((f) => [f.key, f.value])).toEqual([["spouseName", "Laura"], ["spouseDob", "1970-09-30"]]);
    expect(household.label).toBe("Co-client — Laura");
  });

  it("blank cells make no fields, and a row with nothing for a target makes no line for it", () => {
    const drafts = place(PEOPLE_MAP, [rowOf("people:Client", { email: "mark@example.com" })]).drafts;
    expect(drafts.map((d) => d.lineId)).toEqual(["people:Client/client_household"]);
    expect(keysOf(drafts[0].fields)).toEqual(["email"]);

    const coverageOnly = place(PEOPLE_MAP, [rowOf("people:Client", { coveredByWorkplacePlan: "No" })]).drafts;
    expect(coverageOnly.map((d) => [d.lineId, d.fields.map((f) => f.value)])).toEqual([["people:Client/plan_settings_tax_rates", ["no"]]]);
  });

  it("coverage can't save on a plan with no tax settings", () => {
    const [household, settings] = place(PEOPLE_MAP, [clientRow], hendricksBook()).drafts;
    expect(household.blocked).toBeUndefined();
    expect(settings).toMatchObject({
      recordId: null,
      blocked: {
        reason: "This plan has no plan settings yet.",
        cell: { sectionId: "people", rowId: "people:Client", columnId: "coveredByWorkplacePlan" },
      },
    });
  });

  it("a household with no record still updates (the diff says the record is gone)", () => {
    const [household] = place(PEOPLE_MAP, [clientRow], bookWith({})).drafts;
    expect(household).toMatchObject({ recordId: "c1", label: "Client — Mark Hendricks" });
  });
});

describe("HOUSEHOLD_MAP", () => {
  it("filing status and the address update the household; state of residence the tax settings", () => {
    const row = rowOf("household:Household", {
      filingStatus: "Married filing jointly", stateOfResidence: "CO", street: "12 Elm St", address2: "Unit 4",
      city: "Denver", state: "CO", zip: "80202",
    });
    const f = fieldsOf("household", "household:Household");
    expect(place(HOUSEHOLD_MAP, [row]).drafts).toEqual([
      {
        lineId: "household:Household/client_household", sectionId: "household", rowId: "household:Household", target: "client_household",
        recordId: "c1", label: "Household",
        fields: [
          f("filingStatus", "married_joint", "filingStatus"), f("addressLine1", "12 Elm St", "street"), f("addressLine2", "Unit 4", "address2"),
          f("city", "Denver", "city"), f("state", "CO", "state"), f("postalCode", "80202", "zip"),
        ],
        warnings: [],
      },
      {
        lineId: "household:Household/plan_settings_tax_rates", sectionId: "household", rowId: "household:Household", target: "plan_settings_tax_rates",
        recordId: "ps-1", label: "Tax settings",
        fields: [f("residenceState", "CO", "stateOfResidence")],
        warnings: [],
      },
    ]);
  });

  it("only what the row fills: a state of residence alone is one tax settings line", () => {
    const drafts = place(HOUSEHOLD_MAP, [rowOf("household:Household", { stateOfResidence: "TX" })]).drafts;
    expect(drafts.map((d) => [d.lineId, d.fields.map((f) => f.value)])).toEqual([["household:Household/plan_settings_tax_rates", ["TX"]]]);
  });

  it("state of residence can't save on a plan with no tax settings", () => {
    const [settings] = place(HOUSEHOLD_MAP, [rowOf("household:Household", { stateOfResidence: "TX" })], hendricksBook()).drafts;
    expect(settings.blocked).toEqual({
      reason: "This plan has no plan settings yet.",
      cell: { sectionId: "household", rowId: "household:Household", columnId: "stateOfResidence" },
    });
  });
});

describe("FAMILY_MAP", () => {
  const emma = recordOf("fm-emma", "Emma Hendricks", { firstName: "Emma", lastName: "Hendricks" });

  it("a filled row is one family member", () => {
    const row = rowOf("r1", {
      firstName: "Emma", lastName: "Hendricks", relationship: "Son/Daughter-in-law", dateOfBirth: "2004-05-21",
      claimedAsDependent: "No", domesticPartner: true, notes: "Starts college in 2026.",
    });
    const f = fieldsOf("family", "r1");
    expect(place(FAMILY_MAP, [row]).drafts).toEqual([
      {
        lineId: "r1/family_member", sectionId: "family", rowId: "r1", target: "family_member", recordId: null, label: "Emma Hendricks",
        fields: [
          f("firstName", "Emma", "firstName"), f("lastName", "Hendricks", "lastName"), f("relationship", "child_in_law", "relationship"),
          f("dateOfBirth", "2004-05-21", "dateOfBirth"), f("claimedAsDependent", "no", "claimedAsDependent"),
          f("domesticPartner", true, "domesticPartner"), f("notes", "Starts college in 2026.", "notes"),
        ],
        warnings: [],
      },
    ]);
  });

  it("a confirmed link updates that family member; blank cells make no fields; an unchecked box is a value", () => {
    const row = rowOf("r1", { firstName: "Emma", domesticPartner: false }, { link: linkedTo("fm-emma") });
    const [draft] = place(FAMILY_MAP, [row], book({ family_member: [emma] })).drafts;
    expect(draft.recordId).toBe("fm-emma");
    expect(draft.fields.map((f) => [f.key, f.value])).toEqual([["firstName", "Emma"], ["domesticPartner", false]]);
  });

  it("a row linked to a record not in the book never updates it", () => {
    const vanished = rowOf("r1", { firstName: "Emma" }, { link: linkedTo("fm-of-another-client") });
    const unconfirmed = rowOf("r2", { firstName: "Lucas" }, { link: { kind: "existing", recordId: "fm-emma", score: 0.7, confirmed: false, by: "auto" } });
    const drafts = place(FAMILY_MAP, [vanished, unconfirmed], book({ family_member: [emma] })).drafts;
    expect(drafts.map((d) => d.recordId)).toEqual([null, null]);
  });

  it("a row with no first name still makes its line (validation says what's missing)", () => {
    const [draft] = place(FAMILY_MAP, [rowOf("r1", { relationship: "Grandchild" })]).drafts;
    expect(draft).toMatchObject({ label: "Family member", fields: [{ key: "relationship", value: "grandchild" }] });
    expect(draft.blocked).toBeUndefined();
  });
});

describe("EXTERNAL_MAP", () => {
  const redCross = recordOf("eb-1", "Red Cross", { name: "Red Cross", kind: "charity", charityType: "public" });
  const aunt = recordOf("eb-2", "Ruth Miller", { name: "Ruth Miller", kind: "individual", charityType: null });

  it("a filled row is one charity", () => {
    const row = rowOf("x1", { name: "Hendricks Family Foundation", kind: "Charity", charityType: "Private foundation", notes: "Annual gifts" });
    const f = fieldsOf("external", "x1");
    expect(place(EXTERNAL_MAP, [row]).drafts).toEqual([
      {
        lineId: "x1/external_beneficiary", sectionId: "external", rowId: "x1", target: "external_beneficiary", recordId: null,
        label: "Hendricks Family Foundation",
        fields: [
          f("name", "Hendricks Family Foundation", "name"), f("kind", "charity", "kind"),
          f("charityType", "private", "charityType"), f("notes", "Annual gifts", "notes"),
        ],
        warnings: [],
      },
    ]);
  });

  it("a confirmed link updates that record; a link to a record not in the book never does", () => {
    const linked = rowOf("x1", { name: "Red Cross", notes: "Disaster relief" }, { link: linkedTo("eb-1") });
    const vanished = rowOf("x2", { name: "Red Cross" }, { link: linkedTo("eb-of-another-client") });
    const drafts = place(EXTERNAL_MAP, [linked, vanished], book({ external_beneficiary: [redCross] })).drafts;
    expect(drafts.map((d) => d.recordId)).toEqual(["eb-1", null]);
    expect(keysOf(drafts[0].fields)).toEqual(["name", "notes"]);
  });

  it("a charity type on an individual isn't placed, with a warning", () => {
    const warning = "Charity type applies only to a charity.";
    const typed = rowOf("x1", { name: "Ruth Miller", kind: "Individual", charityType: "Public charity" });
    const onRecord = rowOf("x2", { name: "Ruth Miller", charityType: "Public charity" }, { link: linkedTo("eb-2") });
    const drafts = place(EXTERNAL_MAP, [typed, onRecord], book({ external_beneficiary: [aunt] })).drafts;
    expect(drafts.map((d) => [keysOf(d.fields), d.warnings])).toEqual([
      [["name", "kind"], [warning]],
      [["name"], [warning]],
    ]);
  });

  it("a charity type with no kind on a new row is placed (a new beneficiary is a charity unless it says otherwise)", () => {
    const [draft] = place(EXTERNAL_MAP, [rowOf("x1", { name: "Food Bank", charityType: "Public charity" })]).drafts;
    expect(draft.fields.map((f) => [f.key, f.value])).toEqual([["name", "Food Bank"], ["charityType", "public"]]);
    expect(draft.warnings).toEqual([]);
  });
});
