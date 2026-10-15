// src/lib/fact-finder/placement/__tests__/diff.test.ts
import { describe, expect, it } from "vitest";
import type { CellRef, PlacedValue, RecordRef } from "../../change-set";
import { diffDrafts } from "../diff";
import { emptyRecordBook, type BookRecord, type DraftField, type RecordBook, type TargetDraft } from "../types";

const cell = (sectionId: string, rowId: string, columnId: string): CellRef => ({ sectionId, rowId, columnId });
const put = (key: string, value: PlacedValue, from: CellRef[] = []): DraftField => ({ key, value, from });
const client: RecordRef = { ref: "person", role: "client" };
const spouse: RecordRef = { ref: "person", role: "spouse" };
const fm = (id: string): RecordRef => ({ ref: "record", target: "family_member", id });

function draft(over: Partial<TargetDraft> & Pick<TargetDraft, "target" | "fields">): TargetDraft {
  return { lineId: `r1/${over.target}`, sectionId: "cash", rowId: "r1", recordId: null, label: "Joint Checking", warnings: [], ...over };
}

function book(records: Partial<RecordBook["records"]> = {}): RecordBook {
  const base = emptyRecordBook("client-1");
  return {
    ...base,
    scenarioId: "base",
    people: { client: "fm-client", spouse: "fm-spouse" },
    names: { client: "Mark", spouse: "Laura" },
    records: { ...base.records, ...records },
  };
}

const checking: BookRecord = {
  id: "acct-1",
  label: "Joint Checking",
  values: {
    name: "Joint Checking",
    value: 41233,
    growthRate: 0.02,
    owners: [{ who: fm("fm-client"), percent: 0.5 }, { who: fm("fm-spouse"), percent: 0.5 }],
  },
  facts: { category: "cash", subType: "checking" },
};

const household: BookRecord = {
  id: "client-1",
  label: "Mark & Laura Hendricks",
  values: {
    firstName: "Mark", lastName: "Hendricks", dateOfBirth: "1961-04-12", lifeExpectancy: 95,
    spouseName: "Laura", spouseLastName: "Hendricks", spouseDob: "1963-09-02",
  },
};

describe("diffDrafts", () => {
  it("a draft with no record is a Create with every value it placed", () => {
    const nameCell = cell("cash", "r1", "accountName");
    const [line] = diffDrafts([
      draft({
        target: "account",
        fixed: { category: "cash" },
        dependsOn: ["t1/entity"],
        fields: [
          put("name", "Joint Checking", [nameCell]),
          put("value", 41233.5, [cell("cash", "r1", "balance")]),
          { ...put("growthRate", 0.065), with: { growthSource: "custom" } },
          { ...put("custodian", "Fidelity"), ai: { quote: "held at Fidelity" } },
          put("subType", "checking"),
        ],
      }),
    ], book());

    expect(line).toEqual({
      id: "r1/account",
      page: "accounts",
      sectionId: "cash",
      rowId: "r1",
      target: "account",
      action: "create",
      recordId: null,
      label: "Joint Checking",
      fixed: { category: "cash" },
      dependsOn: ["t1/entity"],
      warnings: [],
      fields: [
        { key: "name", label: "Account name", next: "Joint Checking", shown: { next: "Joint Checking" }, ticked: true, from: [nameCell] },
        { key: "value", label: "Current value", next: 41233.5, shown: { next: "$41,233.50" }, ticked: true, from: [cell("cash", "r1", "balance")] },
        { key: "growthRate", label: "Growth rate", next: 0.065, shown: { next: "6.5%" }, ticked: true, from: [], with: { growthSource: "custom" } },
        { key: "custodian", label: "Custodian", next: "Fidelity", shown: { next: "Fidelity" }, ticked: true, from: [], ai: { quote: "held at Fidelity" } },
        { key: "subType", label: "Account type", next: "checking", shown: { next: "Checking" }, ticked: true, from: [] },
      ],
    });
  });

  it("an existing record is an Update with only the values that differ", () => {
    const valueCell = cell("cash", "r1", "balance");
    const [line] = diffDrafts([
      draft({ target: "account", recordId: "acct-1", fields: [put("name", "Joint Checking"), put("value", 45000, [valueCell])] }),
    ], book({ account: [checking] }));

    expect(line.action).toBe("update");
    expect(line.recordId).toBe("acct-1");
    expect(line.fields).toEqual([
      { key: "value", label: "Current value", next: 45000, onRecord: 41233, shown: { next: "$45,000", onRecord: "$41,233" }, ticked: true, from: [valueCell] },
    ]);
  });

  it("fixed values ride only on a Create — an Update or unchanged line carries none", () => {
    const [update, none] = diffDrafts([
      draft({ target: "account", recordId: "acct-1", fixed: { category: "cash" }, fields: [put("value", 45000)] }),
      draft({ lineId: "r2/account", rowId: "r2", target: "account", recordId: "acct-1", fixed: { category: "cash" }, fields: [put("value", 41233)] }),
    ], book({ account: [checking] }));
    expect([update.action, none.action]).toEqual(["update", "none"]);
    expect(update).not.toHaveProperty("fixed");
    expect(none).not.toHaveProperty("fixed");
  });

  it("nothing differs → No changes", () => {
    const [line] = diffDrafts([
      draft({ target: "account", recordId: "acct-1", fields: [put("name", "Joint Checking"), put("value", 41233)] }),
    ], book({ account: [checking] }));
    expect(line).toMatchObject({ action: "none", recordId: "acct-1", fields: [] });
  });

  it("a blank never erases: an empty co-client first name makes no field (Review Focus 1)", () => {
    const [line] = diffDrafts([
      draft({
        lineId: "people:Co-client/client_household",
        sectionId: "people",
        rowId: "people:Co-client",
        target: "client_household",
        recordId: "client-1",
        label: "Co-client — Laura Hendricks",
        fields: [put("spouseName", ""), put("spouseLastName", "Hendricks"), put("spouseDob", null)],
      }),
    ], book({ client_household: [household] }));
    expect(line).toMatchObject({ page: "household", action: "none", fields: [] });
  });

  it("a blank never makes a field on a Create either", () => {
    const [line] = diffDrafts([draft({ target: "account", fields: [put("name", "Joint Checking"), put("custodian", "  "), put("owners", [])] })], book());
    expect(line.fields.map((f) => f.key)).toEqual(["name"]);
  });

  it("a name or owner on record starts unticked; a blank one on record starts ticked", () => {
    const blankName: BookRecord = { ...checking, id: "acct-2", values: { ...checking.values, name: null } };
    const [renamed, named] = diffDrafts([
      draft({
        target: "account",
        recordId: "acct-1",
        fields: [put("name", "Hendricks Checking"), put("owners", [{ who: client, percent: 1 }]), put("growthRate", 0.03)],
      }),
      draft({ lineId: "r2/account", rowId: "r2", target: "account", recordId: "acct-2", fields: [put("name", "Joint Checking")] }),
    ], book({ account: [checking, blankName] }));

    expect(renamed.fields.map((f) => [f.key, f.ticked])).toEqual([["name", false], ["owners", false], ["growthRate", true]]);
    expect(renamed.fields[1].shown).toEqual({ next: "Mark", onRecord: "Joint (50% / 50%)" });
    expect(named.fields).toMatchObject([{ key: "name", onRecord: null, shown: { next: "Joint Checking", onRecord: "—" }, ticked: true }]);
  });

  it("rates within 0.005 points are the same (a stored \"0.0650\")", () => {
    const stored: BookRecord = { ...checking, values: { ...checking.values, growthRate: "0.0650" } };
    const [within, beyond] = diffDrafts([
      draft({ target: "account", recordId: "acct-1", fields: [put("growthRate", 0.06504)] }),
      draft({ lineId: "r2/account", rowId: "r2", target: "account", recordId: "acct-1", fields: [put("growthRate", 0.0651)] }),
    ], book({ account: [stored] }));
    expect(within.action).toBe("none");
    expect(beyond.fields).toMatchObject([{ key: "growthRate", shown: { next: "6.51%", onRecord: "6.5%" } }]);
  });

  it("owners match once a person is the household's family member", () => {
    const [line] = diffDrafts([
      draft({ target: "account", recordId: "acct-1", fields: [put("owners", [{ who: spouse, percent: 0.5 }, { who: client, percent: 0.5 }])] }),
    ], book({ account: [checking] }));
    expect(line.action).toBe("none");
  });

  it("holdings: a ticker's price moving since the last review is No changes; a share count changing is an Update", () => {
    const h = (ticker: string | null, name: string, shares: number | null, price: number | null, marketValue: number) =>
      ({ ticker, name, shares, price, marketValue, costBasis: null });
    const brokerage: BookRecord = {
      id: "acct-3",
      label: "Schwab Brokerage ··4821",
      values: { name: "Schwab Brokerage", holdings: [h("VTI", "Vanguard Total Stock", 120, 250, 30000), h(null, "Hendricks LP", null, null, 15000)] },
      facts: { category: "taxable", subType: "brokerage" },
    };
    const placed = (shares: number) => [h("VTI", "Vanguard Total Stock", shares, 262.5, shares * 262.5), h(null, "Hendricks LP", null, null, 15000)];
    const [repriced, bought] = diffDrafts([
      draft({ lineId: "t1/account", sectionId: "taxable", rowId: "t1", target: "account", recordId: "acct-3", fields: [put("holdings", placed(120))] }),
      draft({ lineId: "t2/account", sectionId: "taxable", rowId: "t2", target: "account", recordId: "acct-3", fields: [put("holdings", placed(150))] }),
    ], book({ account: [brokerage] }));

    expect(repriced).toMatchObject({ action: "none", fields: [] });
    expect(bought.fields).toMatchObject([{ key: "holdings", shown: { next: "2 holdings · $54,375", onRecord: "2 holdings · $45,000" } }]);
  });

  it("changing a date of birth or plan-to age warns that every scenario's plan end moves", () => {
    const person = (fields: DraftField[], warnings: string[] = []) => draft({
      lineId: "people:Client/client_household", sectionId: "people", rowId: "people:Client",
      target: "client_household", recordId: "client-1", label: "Client — Mark Hendricks", fields, warnings,
    });
    const [moved, both, same] = diffDrafts([
      person([put("dateOfBirth", "1961-04-21"), put("firstName", "Mark")], ["From the map."]),
      person([put("dateOfBirth", "1961-04-21"), put("lifeExpectancy", 92)]),
      person([put("dateOfBirth", "1961-04-12"), put("email", "mark@example.com")]),
    ], book({ client_household: [household] }));

    expect(moved.warnings).toEqual(["From the map.", "Changing the date of birth moves every scenario's plan end."]);
    expect(moved.fields[0].shown).toEqual({ next: "Apr 21, 1961", onRecord: "Apr 12, 1961" });
    expect(both.warnings).toEqual(["Changing the date of birth and plan to age moves every scenario's plan end."]);
    expect(same.warnings).toEqual([]);
  });

  it("a beneficiary set replacing one on record that names someone says so — not an unchanged set, an empty one, or a new record's", () => {
    const primary = (who: RecordRef) => [{ tier: "primary", who, percentage: 100 }];
    const onRecord = (beneficiaries: PlacedValue) =>
      book({ account_beneficiary_designation: [{ id: "acct-1", label: "Joint Checking", values: { beneficiaries } }] });
    const line = (b: RecordBook, recordId: string | null = "acct-1") =>
      diffDrafts([draft({ target: "account_beneficiary_designation", recordId, fields: [put("beneficiaries", primary(spouse))], warnings: ["About the row."] })], b)[0];
    expect(line(onRecord(primary(fm("fm-emma")))).warnings).toEqual(["About the row.", "These beneficiaries replace the ones on record."]);
    expect([line(onRecord(primary(spouse))).action, line(onRecord(primary(spouse))).warnings]).toEqual(["none", ["About the row."]]);
    expect(line(onRecord([])).warnings).toEqual(["About the row."]);
    expect(line(book(), null).warnings).toEqual(["About the row."]);
  });

  it("the remaining estate's recipients say so too; a will provision's recipients don't (the will's other provisions stay)", () => {
    const emma = [{ who: fm("fm-emma"), percentage: 100 }];
    const laura = [{ who: spouse, percentage: 100 }];
    const [rest, provision] = diffDrafts(
      [
        draft({ target: "will_residuary_recipient", recordId: "w-1", fields: [put("recipients", laura)] }),
        draft({ lineId: "r2/will_bequest", rowId: "r2", target: "will_bequest", recordId: "bq-1", fields: [put("recipients", laura)] }),
      ],
      book({
        will_residuary_recipient: [{ id: "w-1", label: "Mark's will — remaining estate", values: { recipients: emma } }],
        will_bequest: [{ id: "bq-1", label: "Brokerage", values: { recipients: emma } }],
      }),
    );
    expect([rest.action, rest.warnings]).toEqual(["update", ["These recipients replace the ones on record."]]);
    expect([provision.action, provision.warnings]).toEqual(["update", []]);
  });

  it("a record that's gone from the plan blocks the line", () => {
    const [line] = diffDrafts([draft({ target: "account", recordId: "acct-gone", fields: [put("value", 5000)] })], book({ account: [checking] }));
    expect(line).toMatchObject({
      action: "update",
      recordId: "acct-gone",
      blocked: { reason: "That record is no longer on the plan — review again." },
      fields: [{ key: "value", next: 5000, shown: { next: "$5,000" } }],
    });
    expect(line.fields[0]).not.toHaveProperty("onRecord");
  });

  it("carries a draft's block, parent and AI tag", () => {
    const ownerCell = cell("cash", "r1", "owner");
    const parent: RecordRef = { ref: "line", target: "account", lineId: "r1/account" };
    const [line] = diffDrafts([
      draft({
        lineId: "r1/account_beneficiary_designation", target: "account_beneficiary_designation", sectionId: "retirement",
        fields: [put("beneficiaries", [{ tier: "primary", who: spouse, percentage: 100 }])],
        parent, aiPlaced: true, blocked: { reason: "Owner: pick one.", cell: ownerCell },
      }),
    ], book());
    expect(line).toMatchObject({ page: "accounts", parent, aiPlaced: true, blocked: { reason: "Owner: pick one.", cell: ownerCell } });
    expect(line.fields[0].shown.next).toBe("Laura 100%");
  });

  it("references print the row's draft, the record or the person", () => {
    const trustRecord: BookRecord = { id: "ent-1", label: "Hendricks Family Trust", values: { name: "Hendricks Family Trust" } };
    const lines = diffDrafts([
      draft({ lineId: "t1/entity", sectionId: "trusts", rowId: "t1", target: "entity", label: "Laura's ILIT", fields: [put("name", "Laura's ILIT")] }),
      draft({
        lineId: "b1/will_residuary_recipient", sectionId: "bequests", rowId: "b1", target: "will_residuary_recipient",
        fields: [put("recipients", [
          { who: { ref: "line", target: "entity", lineId: "t1/entity" }, percentage: 50 },
          { who: { ref: "record", target: "entity", id: "ent-1" }, percentage: 25 },
          { who: spouse, percentage: 25 },
        ])],
      }),
    ], book({ entity: [trustRecord] }));
    expect(lines[1].fields[0].shown.next).toBe("Laura's ILIT 50%, Hendricks Family Trust 25%, Laura 25%");
  });

  it("a key the catalog doesn't know is a map bug", () => {
    expect(() => diffDrafts([draft({ target: "account", fields: [put("nickname", "x")] })], book())).toThrow(/account\.nickname/);
  });
});
