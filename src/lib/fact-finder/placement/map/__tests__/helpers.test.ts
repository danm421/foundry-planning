// src/lib/fact-finder/placement/map/__tests__/helpers.test.ts
import { describe, expect, it } from "vitest";
import { bookWith, contextOf, hendricksBook, linkedTo, recordOf, rowOf, stateWith } from "../../__tests__/fixtures";
import { NO_CO_CLIENT_REASON } from "../../refs";
import { bool, cellOf, DraftBuilder, linkedRecordId, num, ownersOf, rate, sharesOf, text } from "../helpers";

const client = { ref: "person", role: "client" } as const;
const spouse = { ref: "person", role: "spouse" } as const;

describe("cell readers", () => {
  const row = rowOf("r1", {
    accountName: "  Joint Checking ",
    custodian: "   ",
    currentValue: 12500,
    interestRate: 6.5,
    typedValue: "about 1.2 million",
    inherited: "Yes",
    interestDeductible: "No",
    domesticPartner: true,
    isGoal: false,
  });

  it("text trims, and a blank or a number is null", () => {
    expect(text(row, "accountName")).toBe("Joint Checking");
    expect(text(row, "custodian")).toBeNull();
    expect(text(row, "currentValue")).toBeNull();
    expect(text(row, "missing")).toBeNull();
  });

  it("num reads only numbers — a value that didn't parse is null", () => {
    expect(num(row, "currentValue")).toBe(12500);
    expect(num(row, "typedValue")).toBeNull();
    expect(num(row, "missing")).toBeNull();
  });

  it("bool reads a check cell or a Yes / No choice", () => {
    expect(bool(row, "domesticPartner")).toBe(true);
    expect(bool(row, "isGoal")).toBe(false);
    expect(bool(row, "inherited")).toBe(true);
    expect(bool(row, "interestDeductible")).toBe(false);
    expect(bool(row, "accountName")).toBeNull();
    expect(bool(row, "missing")).toBeNull();
  });

  it("rate turns a whole percent into a fraction", () => {
    expect(rate(row, "interestRate")).toBe(0.065);
    expect(rate(row, "missing")).toBeNull();
  });

  it("cellOf names the cell", () => {
    expect(cellOf("cash", row, "currentValue")).toEqual({ sectionId: "cash", rowId: "r1", columnId: "currentValue" });
  });
});

describe("DraftBuilder", () => {
  const row = rowOf("cash-1", { accountName: "Joint Checking", currentValue: 0, interestRate: 6.5 });
  const cell = (columnId: string) => ({ sectionId: "cash", rowId: "cash-1", columnId });
  const draft = (init: Partial<ConstructorParameters<typeof DraftBuilder>[0]> = {}) =>
    new DraftBuilder({ sectionId: "cash", row, target: "account", recordId: null, label: "Joint Checking", ...init });

  it("puts values with the cells they came from, and skips a blank — a blank never erases", () => {
    const built = draft({ fixed: { category: "cash" } })
      .put("name", "Joint Checking", ["accountName"])
      .put("value", 0, ["currentValue"])
      .put("growthRate", 0.065, ["interestRate"], { growthSource: "custom" })
      .put("custodian", null, ["custodian"])
      .put("accountNumberLast4", undefined, ["last4"])
      .put("subType", "", ["accountType"])
      .put("holdings", [], [])
      .build();
    expect(built).toEqual({
      lineId: "cash-1/account",
      sectionId: "cash",
      rowId: "cash-1",
      target: "account",
      recordId: null,
      label: "Joint Checking",
      fixed: { category: "cash" },
      fields: [
        { key: "name", value: "Joint Checking", from: [cell("accountName")] },
        { key: "value", value: 0, from: [cell("currentValue")] },
        { key: "growthRate", value: 0.065, from: [cell("interestRate")], with: { growthSource: "custom" } },
      ],
      warnings: [],
    });
  });

  it("keeps false, takes cells from other rows, and a value with no cell (a default) has an empty from", () => {
    const family = rowOf("f1", { domesticPartner: false });
    const other = { sectionId: "people", rowId: "people:Client", columnId: "lastName" };
    const built = new DraftBuilder({ sectionId: "family", row: family, target: "family_member", recordId: "fm-1", label: "Emma" })
      .put("domesticPartner", false, ["domesticPartner"])
      .put("lastName", "Hendricks", [other])
      .put("notes", "Added by default", [])
      .build();
    expect(built.fields).toEqual([
      { key: "domesticPartner", value: false, from: [{ sectionId: "family", rowId: "f1", columnId: "domesticPartner" }] },
      { key: "lastName", value: "Hendricks", from: [other] },
      { key: "notes", value: "Added by default", from: [] },
    ]);
  });

  it("numbers a row's second line of one target, and knows the ref its record will have", () => {
    expect(draft({ n: 2 }).lineId).toBe("cash-1/account/2");
    expect(draft().ref).toEqual({ ref: "line", target: "account", lineId: "cash-1/account" });
    expect(draft({ recordId: "a-1" }).ref).toEqual({ ref: "record", target: "account", id: "a-1" });
  });

  it("depends on every Create line it refers to — in a value, `with`, `fixed` or `parent` — and on dependOn", () => {
    const house = { ref: "line", target: "account", lineId: "h1/account" } as const;
    const fund = { ref: "line", target: "account", lineId: "c9/account" } as const;
    const trust = { ref: "line", target: "entity", lineId: "tr1/entity" } as const;
    const built = new DraftBuilder({
      sectionId: "liab",
      row: rowOf("l1", { loanName: "Mortgage" }),
      target: "liability",
      recordId: null,
      label: "Mortgage",
      fixed: { ownerAccountId: fund },
      parent: { ref: "record", target: "account", id: "a-1" },
    })
      .put("linkedPropertyId", house, ["propertyName"])
      .put("owners", [{ who: trust, percent: 1 }, { who: client, percent: 0 }], ["owner", "ownerEntity"])
      .put("name", "Mortgage", ["loanName"], { escrowFrom: house })
      .dependOn(null)
      .dependOn({ ref: "record", target: "account", id: "a-2" })
      .dependOn({ ref: "line", target: "income", lineId: "i1/income" })
      .build();
    expect(built.parent).toEqual({ ref: "record", target: "account", id: "a-1" });
    expect(built.dependsOn).toEqual(["c9/account", "h1/account", "tr1/entity", "i1/income"]);
    expect(draft().build()).not.toHaveProperty("dependsOn");
  });

  it("keeps the first block (with its cell) and each warning once", () => {
    const built = draft()
      .warn("Joint titling applies only to a joint account.")
      .warn("Joint titling applies only to a joint account.")
      .block("Pick which trust or entity owns it.", "ownerEntity")
      .block("Something later.")
      .build();
    expect(built.warnings).toEqual(["Joint titling applies only to a joint account."]);
    expect(built.blocked).toEqual({ reason: "Pick which trust or entity owns it.", cell: cell("ownerEntity") });
    expect(draft().block("No cell.").build().blocked).toEqual({ reason: "No cell." });
  });

  it("refuses a key its target doesn't have, and a key placed twice — map bugs, not advisor input", () => {
    expect(() => draft().put("nmae", "Joint Checking", ["accountName"])).toThrow('account has no field "nmae"');
    expect(() => draft().put("name", "A", ["accountName"]).put("name", "B", ["accountName"])).toThrow('cash-1/account: "name" placed twice');
    expect(() => draft().put("name", null, ["accountName"]).put("name", "B", ["accountName"])).not.toThrow();
  });
});

describe("linkedRecordId", () => {
  const book = bookWith({ account: [recordOf("a-1", "Joint Checking", {})], business_account: [recordOf("b-1", "Design Co", {})] });
  const { ctx } = contextOf(stateWith({}), book);
  const withLink = (link: Parameters<typeof rowOf>[2]) => rowOf("r", { accountName: "X" }, link);

  it("is the record a confirmed link names, when this client's book has it", () => {
    expect(linkedRecordId(withLink({ link: linkedTo("a-1") }), ctx, ["account"])).toBe("a-1");
    expect(linkedRecordId(withLink({ link: linkedTo("b-1") }), ctx, ["account", "business_account"])).toBe("b-1");
  });

  it("is null for a record not in the book (another client's, or deleted), a guess, New and no link", () => {
    expect(linkedRecordId(withLink({ link: linkedTo("a-of-another-client") }), ctx, ["account"])).toBeNull();
    expect(linkedRecordId(withLink({ link: linkedTo("b-1") }), ctx, ["account"])).toBeNull();
    expect(linkedRecordId(withLink({ link: { kind: "existing", recordId: "a-1", score: 0.7, confirmed: false, by: "auto" } }), ctx, ["account"])).toBeNull();
    expect(linkedRecordId(withLink({ link: { kind: "new", by: "advisor" } }), ctx, ["account"])).toBeNull();
    expect(linkedRecordId(withLink({}), ctx, ["account"])).toBeNull();
  });
});

describe("ownersOf", () => {
  const state = stateWith({ trusts: [rowOf("tr1", { trustName: "Hendricks ILIT", trustType: "ILIT" })] });
  const { ctx } = contextOf(state, hendricksBook({ entity: [recordOf("e-1", "Smith Family Trust", { name: "Smith Family Trust" })] }));
  const owners = (values: Record<string, string>, opts?: { ownerColumn?: string }) => ownersOf("cash", rowOf("c1", values), ctx, opts);

  it("Client, Co-client and Joint are the household's people, from the Owner column", () => {
    expect(owners({ owner: "Client" })).toEqual({ ok: true, owners: [{ who: client, percent: 1 }], columns: ["owner"] });
    expect(owners({ owner: "Co-client" })).toEqual({ ok: true, owners: [{ who: spouse, percent: 1 }], columns: ["owner"] });
    expect(owners({ owner: "Joint" })).toEqual({ ok: true, owners: [{ who: client, percent: 0.5 }, { who: spouse, percent: 0.5 }], columns: ["owner"] });
  });

  it("Trust / entity is the trust Which trust / entity names, in the fact finder or on the plan — from both columns", () => {
    expect(owners({ owner: "Trust / entity", ownerEntity: "Hendricks ILIT" })).toEqual({
      ok: true,
      owners: [{ who: { ref: "line", target: "entity", lineId: "tr1/entity" }, percent: 1 }],
      columns: ["owner", "ownerEntity"],
    });
    expect(owners({ owner: "Trust / entity", ownerEntity: "Smith Family Trust" })).toEqual({
      ok: true,
      owners: [{ who: { ref: "record", target: "entity", id: "e-1" }, percent: 1 }],
      columns: ["owner", "ownerEntity"],
    });
    expect(owners({ owner: "Trust / entity" })).toEqual({ ok: false, reason: "Pick which trust or entity owns it.", columnId: "ownerEntity" });
    expect(owners({ owner: "Trust / entity", ownerEntity: "Lake Trust" })).toEqual({
      ok: false,
      reason: 'No trust or entity named "Lake Trust" in this fact finder or on the plan.',
      columnId: "ownerEntity",
    });
  });

  it("reads Which trust / entity only when Owner is exactly Trust / entity; a blank Owner is no owners", () => {
    expect(owners({ owner: "Client", ownerEntity: "Lake Trust" })).toEqual({ ok: true, owners: [{ who: client, percent: 1 }], columns: ["owner"] });
    expect(owners({ ownerEntity: "Hendricks ILIT" })).toEqual({ ok: true, owners: [], columns: ["owner"] });
  });

  it("Co-client and Joint need a co-client", () => {
    const { ctx: single } = contextOf(stateWith({}), bookWith({}, { people: { client: "fm-client", spouse: null } }));
    expect(ownersOf("cash", rowOf("c1", { owner: "Joint" }), single)).toEqual({ ok: false, reason: NO_CO_CLIENT_REASON, columnId: "owner" });
    expect(ownersOf("cash", rowOf("c1", { owner: "Co-client" }), single)).toMatchObject({ ok: false, columnId: "owner" });
    expect(ownersOf("cash", rowOf("c1", { owner: "Client" }), single)).toEqual({ ok: true, owners: [{ who: client, percent: 1 }], columns: ["owner"] });
  });

  it("a blank Owner on a new record: blocked when there's a co-client, on record or added here; else the client alone, from the Owner cell", () => {
    expect(ownersOf("cash", rowOf("c1", {}), ctx, { create: true })).toEqual({ ok: false, reason: "Owner: pick who owns it.", columnId: "owner" });
    const solo = bookWith({}, { people: { client: "fm-client", spouse: null } });
    const { ctx: single } = contextOf(stateWith({}), solo);
    expect(ownersOf("cash", rowOf("c1", {}), single, { create: true })).toEqual({ ok: true, owners: [{ who: client, percent: 1 }], columns: ["owner"] });
    const { ctx: adding } = contextOf(stateWith({ people: [rowOf("people:Co-client", { firstName: "Laura" })] }), solo);
    expect(ownersOf("cash", rowOf("c1", {}), adding, { create: true })).toEqual({ ok: false, reason: "Owner: pick who owns it.", columnId: "owner" });
    // An update keeps the owners on record: a blank never erases.
    expect(ownersOf("cash", rowOf("c1", {}), ctx)).toEqual({ ok: true, owners: [], columns: ["owner"] });
  });

  it("reads another owner column when asked, and refuses a value that isn't an option", () => {
    expect(owners({ heldBy: "Co-client" }, { ownerColumn: "heldBy" })).toEqual({ ok: true, owners: [{ who: spouse, percent: 1 }], columns: ["heldBy"] });
    expect(owners({ owner: "Mark & Laura" })).toEqual({
      ok: false,
      reason: 'Owner: "Mark & Laura" isn\'t one of the options — pick one.',
      columnId: "owner",
    });
  });
});

describe("sharesOf", () => {
  const state = stateWith({
    family: [rowOf("f1", { firstName: "Emma", lastName: "Hendricks" }), rowOf("f2", { firstName: "Lucas", lastName: "Hendricks" })],
  });
  const { ctx } = contextOf(state, hendricksBook());
  const emma = { ref: "line", target: "family_member", lineId: "f1/family_member" };
  const lucas = { ref: "line", target: "family_member", lineId: "f2/family_member" };

  it("resolves each name and keeps its whole percent", () => {
    expect(sharesOf("Laura 100%", ctx, ["household", "family"])).toEqual({
      ok: true,
      shares: [{ who: spouse, percent: 100, label: "Laura Hendricks" }],
    });
    expect(sharesOf("Emma 60%, Lucas Hendricks 40%", ctx, ["family"])).toEqual({
      ok: true,
      shares: [
        { who: emma, percent: 60, label: "Emma Hendricks" },
        { who: lucas, percent: 40, label: "Lucas Hendricks" },
      ],
    });
    expect(sharesOf("Emma and Lucas equally", ctx, ["family"])).toMatchObject({
      ok: true,
      shares: [{ who: emma, percent: 50 }, { who: lucas, percent: 50 }],
    });
  });

  it("takes a whole name that holds a separator as one name: a joint ILIT, a charity with an ampersand", () => {
    const named = stateWith({
      trusts: [rowOf("t1", { trustName: "Mark and Laura Hendricks ILIT", trustType: "ILIT" })],
      external: [rowOf("x1", { name: "Boys & Girls Club", kind: "Charity" })],
    });
    const { ctx: withThem } = contextOf(named, hendricksBook());
    const ilit = { ref: "line", target: "entity", lineId: "t1/entity" };
    const club = { ref: "line", target: "external_beneficiary", lineId: "x1/external_beneficiary" };
    expect(sharesOf("Mark and Laura Hendricks ILIT", withThem, ["trust"])).toEqual({ ok: true, shares: [{ who: ilit, percent: 100, label: "Mark and Laura Hendricks ILIT" }] });
    expect(sharesOf("Boys & Girls Club 100%", withThem, ["external"])).toMatchObject({ ok: true, shares: [{ who: club, percent: 100 }] });
    expect(sharesOf("Boys & Girls Club 50%", withThem, ["external"])).toEqual({ ok: false, reason: "Shares add up to 50%, not 100%." });
  });

  it("is not ok with the first reason: shares that don't add up, or a name that doesn't resolve", () => {
    expect(sharesOf("Emma 60%, Lucas 30%", ctx, ["family"])).toEqual({ ok: false, reason: "Shares add up to 90%, not 100%." });
    expect(sharesOf("Emma 50%, Zoe 50%", ctx, ["family"])).toEqual({
      ok: false,
      reason: 'No one named "Zoe" in this fact finder or on the plan.',
    });
    expect(sharesOf("Laura 100%", ctx, ["family"])).toEqual({ ok: false, reason: '"Laura" is the co-client, who can\'t be named here.' });
  });
});
