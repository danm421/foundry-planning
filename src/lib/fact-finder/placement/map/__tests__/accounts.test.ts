// src/lib/fact-finder/placement/map/__tests__/accounts.test.ts
import { describe, expect, it } from "vitest";
import { findSection } from "../../../schema";
import type { FFHolding, FFRow } from "../../../types";
import { bookWith, contextOf, hendricksBook, linkedTo, recordOf, rowOf, stateWith } from "../../__tests__/fixtures";
import { NO_CO_CLIENT_REASON } from "../../refs";
import type { BookRecord, RecordBook, TargetDraft } from "../../types";
import { CASH_MAP, EDU_MAP, RETIREMENT_MAP, TAXABLE_MAP } from "../accounts";
import type { SectionMap } from "../types";

const client = { ref: "person", role: "client" } as const;
const spouse = { ref: "person", role: "spouse" } as const;
const emma = { ref: "record", target: "family_member", id: "fm-emma" } as const;
const lucas = { ref: "record", target: "family_member", id: "fm-lucas" } as const;
const kids = {
  family_member: [
    recordOf("fm-emma", "Emma Hendricks", { firstName: "Emma", lastName: "Hendricks" }),
    recordOf("fm-lucas", "Lucas Hendricks", { firstName: "Lucas", lastName: "Hendricks" }),
  ],
};

/** `map.place` over these rows (other sections alongside) against `book` — Mark & Laura and their kids by default. */
function place(map: SectionMap, rows: FFRow[], book: RecordBook = hendricksBook(kids), other: Record<string, FFRow[]> = {}) {
  const { ctx, notices } = contextOf(stateWith({ [map.sectionId]: rows, ...other }), book);
  return { drafts: map.place(rows, ctx), notices };
}
const at = (sectionId: string, rowId: string) => (columnId: string) => ({ sectionId, rowId, columnId });
const values = (d: TargetDraft) => Object.fromEntries(d.fields.map((f) => [f.key, f.value]));
const keysOf = (d: TargetDraft) => d.fields.map((f) => f.key);

/** An account on record, with the facts Task 15's book gives every account. */
const accountRecord = (id: string, label: string, vals: BookRecord["values"], facts: BookRecord["facts"] = {}) =>
  recordOf(id, label, vals, { category: "cash", subType: null, parentAccountId: null, isDefaultChecking: false, ...facts });

const holding = (id: string, h: Partial<FFHolding>): FFHolding => ({
  id, ticker: null, name: null, shares: null, price: null, marketValue: null, costBasis: null, by: "document", ...h,
});

/** Mark on record, no co-client. */
const singleBook = bookWith(
  { client_household: [recordOf("c1", "Mark Hendricks", { firstName: "Mark", lastName: "Hendricks" })] },
  { people: { client: "fm-client", spouse: null }, names: { client: "Mark", spouse: null } },
);

describe("placements", () => {
  it.each([CASH_MAP, TAXABLE_MAP, RETIREMENT_MAP, EDU_MAP])("$sectionId places every column exactly once", (map) => {
    expect(Object.keys(map.placements)).toEqual(findSection(map.sectionId)!.columns.map((c) => c.id));
  });

  it("Interest rate % is the only percent column of the four sections", () => {
    const percents = ["cash", "taxable", "retirement", "edu"].flatMap((id) =>
      findSection(id)!.columns.filter((c) => c.kind === "percent").map((c) => `${id}.${c.id}`),
    );
    expect(percents).toEqual(["cash.interestRate"]);
  });
});

describe("CASH_MAP", () => {
  const c = at("cash", "cash-1");
  const filled = rowOf("cash-1", {
    accountName: "Joint Checking", currentValue: 12500, last4: "****1234", owner: "Joint", jointTitling: "JTWROS",
    custodian: "Chase", accountType: "Checking", interestRate: 6.5,
    ownerEntity: "Hendricks Family Trust", // not read: Owner isn't "Trust / entity"
  });

  it("a filled joint account: every field from its cell, 6.5% as 0.065 with a custom growth source", () => {
    expect(place(CASH_MAP, [filled]).drafts).toEqual([
      {
        lineId: "cash-1/account",
        sectionId: "cash",
        rowId: "cash-1",
        target: "account",
        recordId: null,
        label: "Joint Checking ··1234",
        fixed: { category: "cash" },
        fields: [
          { key: "name", value: "Joint Checking", from: [c("accountName")] },
          { key: "value", value: 12500, from: [c("currentValue")] },
          { key: "accountNumberLast4", value: "1234", from: [c("last4")] },
          { key: "custodian", value: "Chase", from: [c("custodian")] },
          { key: "subType", value: "checking", from: [c("accountType")] },
          { key: "owners", value: [{ who: client, percent: 0.5 }, { who: spouse, percent: 0.5 }], from: [c("owner")] },
          { key: "titlingType", value: "jtwros", from: [c("jointTitling")] },
          { key: "growthRate", value: 0.065, from: [c("interestRate")], with: { growthSource: "custom" } },
        ],
        warnings: [],
      },
    ]);
  });

  it("a blank cell makes no field, so nothing on record is erased; the label falls back to the record's", () => {
    const book = hendricksBook({ account: [accountRecord("a-1", "Joint Checking ··1234", { name: "Joint Checking", accountNumberLast4: "1234" })] });
    const [draft] = place(CASH_MAP, [rowOf("cash-1", { currentValue: 13000 }, { link: linkedTo("a-1") })], book).drafts;
    expect(draft).toMatchObject({ recordId: "a-1", label: "Joint Checking ··1234", fields: [{ key: "value", value: 13000, from: [c("currentValue")] }] });
    expect(draft.warnings).toEqual([]);
  });

  it("a row linked to a record not in the book never updates it", () => {
    const [draft] = place(CASH_MAP, [rowOf("cash-1", { accountName: "Joint Checking" }, { link: linkedTo("a-of-another-client") })]).drafts;
    expect(draft.recordId).toBeNull();
  });

  it("Joint titling is saved only on a joint account — the row's Owner, else the owners on record", () => {
    const solo = place(CASH_MAP, [rowOf("cash-1", { owner: "Client", jointTitling: "JTWROS" })]).drafts[0];
    expect(keysOf(solo)).toEqual(["owners"]);
    expect(solo.warnings).toEqual(["Joint titling applies only to a joint account."]);

    const joint = accountRecord("a-1", "Joint Checking", { owners: [{ who: client, percent: 0.5 }, { who: spouse, percent: 0.5 }] });
    const onRecord = place(CASH_MAP, [rowOf("cash-1", { jointTitling: "Community property" }, { link: linkedTo("a-1") })], hendricksBook({ account: [joint] }));
    expect(onRecord.drafts[0].fields).toEqual([{ key: "titlingType", value: "community_property", from: [c("jointTitling")] }]);
    expect(onRecord.drafts[0].warnings).toEqual([]);

    const unknown = place(CASH_MAP, [rowOf("cash-1", { jointTitling: "JTWROS" })]).drafts[0];
    expect(unknown.fields).toEqual([]);
    expect(unknown.warnings).toEqual(["Joint titling applies only to a joint account."]);
  });

  it("Co-client or Joint with no co-client on the plan blocks the account", () => {
    for (const owner of ["Co-client", "Joint"]) {
      const [draft] = place(CASH_MAP, [rowOf("cash-1", { accountName: "Checking", owner })], singleBook).drafts;
      expect(draft.blocked).toEqual({ reason: NO_CO_CLIENT_REASON, cell: c("owner") });
      expect(keysOf(draft)).toEqual(["name"]);
    }
  });

  it("every row makes its account line, even one whose cells all went elsewhere", () => {
    expect(place(CASH_MAP, [rowOf("cash-1", { ownerEntity: "Hendricks Family Trust" })]).drafts).toMatchObject([
      { lineId: "cash-1/account", label: "Cash account", fields: [] },
    ]);
  });
});

describe("accounts the plan manages itself", () => {
  const business = recordOf("biz-1", "Acme LLC", { name: "Acme LLC" }, { category: "business", subType: "llc", parentAccountId: null, isDefaultChecking: false });

  it("the household's main checking keeps its owner and type on record", () => {
    const main = accountRecord("a-main", "Household Checking", { name: "Household Checking" }, { subType: "checking", isDefaultChecking: true });
    const row = rowOf("cash-1", { currentValue: 9000, owner: "Joint", accountType: "Savings" }, { link: linkedTo("a-main") });
    const [draft] = place(CASH_MAP, [row], hendricksBook({ account: [main] })).drafts;
    expect(keysOf(draft)).toEqual(["value"]);
    expect(draft.warnings).toEqual(["The plan manages this account's owner and type."]);
    expect(draft.blocked).toBeUndefined();
  });

  it("a business's cash account says so once — and an unpicked trust doesn't block it", () => {
    const rider = accountRecord("a-cash", "Acme LLC — Cash", { name: "Acme LLC — Cash" }, { subType: "checking", parentAccountId: "biz-1", isDefaultChecking: true });
    const row = rowOf("cash-1", { owner: "Trust / entity", accountType: "Checking" }, { link: linkedTo("a-cash") });
    const [draft] = place(CASH_MAP, [row], hendricksBook({ account: [rider], business_account: [business] })).drafts;
    expect(draft.fields).toEqual([]);
    expect(draft.warnings).toEqual(["The plan manages this account's owner and type."]);
    expect(draft.blocked).toBeUndefined();
  });

  it("a business's own account keeps its owner (the business) but takes its type", () => {
    const child = accountRecord("a-biz", "Acme Brokerage", { name: "Acme Brokerage" }, { category: "taxable", subType: "brokerage", parentAccountId: "biz-1" });
    const row = rowOf("tax-1", { owner: "Client", accountType: "Other" }, { link: linkedTo("a-biz") });
    const [draft] = place(TAXABLE_MAP, [row], hendricksBook({ account: [child], business_account: [business] })).drafts;
    expect(values(draft)).toEqual({ subType: "other" });
    expect(draft.warnings).toEqual(["This account is owned through Acme LLC."]);
  });

  it("no warning when the row names no owner or type", () => {
    const main = accountRecord("a-main", "Household Checking", { name: "Household Checking" }, { isDefaultChecking: true });
    const [draft] = place(CASH_MAP, [rowOf("cash-1", { currentValue: 9000 }, { link: linkedTo("a-main") })], hendricksBook({ account: [main] })).drafts;
    expect(draft.warnings).toEqual([]);
  });
});

describe("TAXABLE_MAP", () => {
  const c = at("taxable", "tax-1");

  it("a filled account: Cost basis is its basis, and \"Trust\" is an account type, not an owner", () => {
    const row = rowOf("tax-1", {
      accountName: "Schwab Brokerage", currentValue: 250000, costBasis: 180000, last4: "4455", owner: "Client",
      jointTitling: "JTWROS", custodian: "Schwab", accountType: "Trust", ownerEntity: "Hendricks Family Trust",
    });
    const [draft] = place(TAXABLE_MAP, [row]).drafts;
    expect(draft).toMatchObject({ lineId: "tax-1/account", label: "Schwab Brokerage ··4455", fixed: { category: "taxable" } });
    expect(draft.fields).toEqual([
      { key: "name", value: "Schwab Brokerage", from: [c("accountName")] },
      { key: "value", value: 250000, from: [c("currentValue")] },
      { key: "accountNumberLast4", value: "4455", from: [c("last4")] },
      { key: "custodian", value: "Schwab", from: [c("custodian")] },
      { key: "subType", value: "trust", from: [c("accountType")] },
      { key: "owners", value: [{ who: client, percent: 1 }], from: [c("owner")] },
      { key: "basis", value: 180000, from: [c("costBasis")] },
    ]);
    expect(draft.warnings).toEqual(["Joint titling applies only to a joint account."]);
  });

  describe("a trust-owned account", () => {
    const trustRow = rowOf("trust-1", { trustName: "Hendricks Family Trust", trustType: "Irrevocable" });
    const row = rowOf("tax-1", { accountName: "Trust Brokerage", owner: "Trust / entity", ownerEntity: "Hendricks Family Trust" });

    it("a Trusts row: the line that trust's row creates (and the account waits for it)", () => {
      const [draft] = place(TAXABLE_MAP, [row], hendricksBook(), { trusts: [trustRow] }).drafts;
      const trust = { ref: "line", target: "entity", lineId: "trust-1/entity" } as const;
      expect(draft.fields[1]).toEqual({ key: "owners", value: [{ who: trust, percent: 1 }], from: [c("owner"), c("ownerEntity")] });
      expect(draft.dependsOn).toEqual(["trust-1/entity"]);
    });

    it("a trust on record: that record", () => {
      const book = hendricksBook({ entity: [recordOf("ent-1", "Hendricks Family Trust", { name: "Hendricks Family Trust" })] });
      const [draft] = place(TAXABLE_MAP, [row], book).drafts;
      expect(values(draft).owners).toEqual([{ who: { ref: "record", target: "entity", id: "ent-1" }, percent: 1 }]);
      expect(draft.dependsOn).toBeUndefined();
    });

    it("no trust named: blocked on Which trust / entity", () => {
      const [draft] = place(TAXABLE_MAP, [rowOf("tax-1", { accountName: "Trust Brokerage", owner: "Trust / entity" })]).drafts;
      expect(draft.blocked).toEqual({ reason: "Pick which trust or entity owns it.", cell: c("ownerEntity") });
    });
  });

  describe("holdings", () => {
    const positions = [
      holding("h1", { ticker: "AAPL", name: "Apple Inc.", shares: 100, price: 195.555, costBasis: 12000 }),
      holding("h2", { name: "Growth Fund", marketValue: 5000, costBasis: 4000, pinned: true }),
    ];

    it("go as the account's positions — shares × price when there's no market value — and never feed its basis", () => {
      const [draft] = place(TAXABLE_MAP, [rowOf("tax-1", { accountName: "Schwab Brokerage" }, { holdings: positions })]).drafts;
      expect(draft.fields[1]).toEqual({
        key: "holdings",
        value: [
          { ticker: "AAPL", name: "Apple Inc.", shares: 100, price: 195.555, marketValue: 19555.5, costBasis: 12000 },
          { ticker: null, name: "Growth Fund", shares: null, price: null, marketValue: 5000, costBasis: 4000 },
        ],
        from: [],
      });
      expect(keysOf(draft)).toEqual(["name", "holdings"]);
      expect(draft.warnings).toEqual(["Saving these 2 positions makes this account take its value from them."]);
    });

    it("no warning for an account that already holds positions on record", () => {
      const onRecord = accountRecord("a-1", "Schwab Brokerage", { holdings: [{ ticker: "AAPL", name: "Apple Inc.", shares: 90, price: 195, marketValue: 17550, costBasis: 11000 }] });
      const [draft] = place(TAXABLE_MAP, [rowOf("tax-1", {}, { holdings: positions, link: linkedTo("a-1") })], hendricksBook({ account: [onRecord] })).drafts;
      expect(keysOf(draft)).toEqual(["holdings"]);
      expect(draft.warnings).toEqual([]);
    });

    it("one position", () => {
      const [draft] = place(TAXABLE_MAP, [rowOf("tax-1", { accountName: "Schwab" }, { holdings: [positions[0]] })]).drafts;
      expect(draft.warnings).toEqual(["Saving this position makes this account take its value from it."]);
    });
  });
});

describe("RETIREMENT_MAP", () => {
  const c = at("retirement", "ret-1");
  const filled = rowOf("ret-1", {
    accountName: "Fidelity 401(k)", currentValue: 412330, rothPortion: 25000, afterTaxBasis: 5000, last4: "5678",
    owner: "Client", custodian: "Fidelity", accountType: "401(k)", inherited: "No", priorYearEndValue: 400000,
    primaryBeneficiary: "Laura 100%", contingentBeneficiary: "Emma 50%, Lucas 50%",
  });

  it("a filled 401(k): the account, and its beneficiaries as a second line hanging off it", () => {
    expect(place(RETIREMENT_MAP, [filled]).drafts).toEqual([
      {
        lineId: "ret-1/account",
        sectionId: "retirement",
        rowId: "ret-1",
        target: "account",
        recordId: null,
        label: "Fidelity 401(k) ··5678",
        fixed: { category: "retirement" },
        fields: [
          { key: "name", value: "Fidelity 401(k)", from: [c("accountName")] },
          { key: "value", value: 412330, from: [c("currentValue")] },
          { key: "accountNumberLast4", value: "5678", from: [c("last4")] },
          { key: "custodian", value: "Fidelity", from: [c("custodian")] },
          { key: "subType", value: "401k", from: [c("accountType")] },
          { key: "owners", value: [{ who: client, percent: 1 }], from: [c("owner")] },
          { key: "rothValue", value: 25000, from: [c("rothPortion")] },
          { key: "basis", value: 5000, from: [c("afterTaxBasis")] },
          { key: "priorYearEndValue", value: 400000, from: [c("priorYearEndValue")] },
        ],
        warnings: [],
      },
      {
        lineId: "ret-1/account_beneficiary_designation",
        sectionId: "retirement",
        rowId: "ret-1",
        target: "account_beneficiary_designation",
        recordId: null,
        label: "Fidelity 401(k) ··5678 — beneficiaries",
        fields: [
          {
            key: "beneficiaries",
            value: [
              { tier: "primary", who: spouse, percentage: 100 },
              { tier: "contingent", who: emma, percentage: 50 },
              { tier: "contingent", who: lucas, percentage: 50 },
            ],
            from: [c("primaryBeneficiary"), c("contingentBeneficiary")],
          },
        ],
        warnings: ["These beneficiaries replace the default beneficiaries a new retirement account gets."],
        parent: { ref: "line", target: "account", lineId: "ret-1/account" },
        dependsOn: ["ret-1/account"],
      },
    ]);
  });

  it("Roth portion only on a 401(k) or 403(b) — the row's type, else the record's", () => {
    const ira = place(RETIREMENT_MAP, [rowOf("ret-1", { accountType: "Traditional IRA", rothPortion: 25000 })]).drafts[0];
    expect(keysOf(ira)).toEqual(["subType"]);
    expect(ira.warnings).toEqual(["Roth portion applies only to a 401(k) or 403(b)."]);

    const k403 = accountRecord("k-1", "TIAA 403(b)", { name: "TIAA 403(b)" }, { category: "retirement", subType: "403b" });
    const onRecord = place(RETIREMENT_MAP, [rowOf("ret-1", { rothPortion: 25000 }, { link: linkedTo("k-1") })], hendricksBook({ ...kids, account: [k403] }));
    expect(onRecord.drafts[0].fields).toEqual([{ key: "rothValue", value: 25000, from: [c("rothPortion")] }]);

    const untyped = place(RETIREMENT_MAP, [rowOf("ret-1", { rothPortion: 25000 })]).drafts[0];
    expect(untyped.fields).toEqual([]);
    expect(untyped.warnings).toEqual(["Roth portion applies only to a 401(k) or 403(b)."]);
  });

  it("After-tax basis is an IRA's basis, but not a Roth IRA's — and a holding's cost basis never feeds it", () => {
    const roth = place(RETIREMENT_MAP, [rowOf("ret-1", { accountType: "Roth IRA", afterTaxBasis: 6000 })]).drafts[0];
    expect(keysOf(roth)).toEqual(["subType"]);
    expect(roth.warnings).toEqual(["After-tax basis doesn't apply to a Roth IRA."]);

    const ira = place(RETIREMENT_MAP, [rowOf("ret-1", { accountType: "Traditional IRA", afterTaxBasis: 6000 })]).drafts[0];
    expect(values(ira)).toEqual({ subType: "traditional_ira", basis: 6000 });

    const held = rowOf("ret-1", { accountType: "Traditional IRA" }, { holdings: [holding("h1", { ticker: "VTI", shares: 10, price: 250, costBasis: 2000 })] });
    expect(keysOf(place(RETIREMENT_MAP, [held]).drafts[0])).toEqual(["subType", "holdings"]);
  });

  describe("Inherited?", () => {
    it('"Yes" with both years on a Traditional or Roth IRA saves the inheritance', () => {
      const row = rowOf("ret-1", { accountType: "Traditional IRA", inherited: "Yes", originalOwnerBirthYear: 1940, originalOwnerDeathYear: 2022 });
      const [draft] = place(RETIREMENT_MAP, [row]).drafts;
      expect(draft.fields.slice(1)).toEqual([
        { key: "inheritedOwnerBirthYear", value: 1940, from: [c("inherited"), c("originalOwnerBirthYear")] },
        { key: "inheritedDeathYear", value: 2022, from: [c("inherited"), c("originalOwnerDeathYear")] },
      ]);
      expect(draft.warnings).toEqual([]);

      const rothIra = accountRecord("ira-1", "Inherited Roth", { name: "Inherited Roth" }, { category: "retirement", subType: "roth_ira" });
      const linked = rowOf("ret-1", { inherited: "Yes", originalOwnerBirthYear: 1940, originalOwnerDeathYear: 2022 }, { link: linkedTo("ira-1") });
      expect(keysOf(place(RETIREMENT_MAP, [linked], hendricksBook({ account: [rothIra] })).drafts[0])).toEqual(["inheritedOwnerBirthYear", "inheritedDeathYear"]);
    });

    it('"Yes" without both years, or on another type, warns and saves nothing of it', () => {
      const why = "To save the inheritance, add the original owner's birth year and year of death (Traditional or Roth IRA only).";
      for (const cells of [
        { accountType: "Traditional IRA", inherited: "Yes", originalOwnerBirthYear: null, originalOwnerDeathYear: 2022 },
        { accountType: "401(k)", inherited: "Yes", originalOwnerBirthYear: 1940, originalOwnerDeathYear: 2022 },
      ]) {
        const [draft] = place(RETIREMENT_MAP, [rowOf("ret-1", cells)]).drafts;
        expect(keysOf(draft)).toEqual(["subType"]);
        expect(draft.warnings).toEqual([why]);
      }
    });

    it('"No" saves nothing; years without "Yes" warn', () => {
      const no = place(RETIREMENT_MAP, [rowOf("ret-1", { accountType: "Traditional IRA", inherited: "No" })]).drafts[0];
      expect(keysOf(no)).toEqual(["subType"]);
      expect(no.warnings).toEqual([]);
      const years = place(RETIREMENT_MAP, [rowOf("ret-1", { accountType: "Traditional IRA", originalOwnerBirthYear: 1940, originalOwnerDeathYear: 2022 })]).drafts[0];
      expect(keysOf(years)).toEqual(["subType"]);
      expect(years.warnings).toEqual(['The original owner\'s years are saved only when Inherited? is "Yes".']);
    });
  });

  describe("beneficiaries", () => {
    const k401 = accountRecord("k-1", "Fidelity 401(k) ··5678", { name: "Fidelity 401(k)" }, { category: "retirement", subType: "401k" });
    const onRecord = recordOf("k-1", "Fidelity 401(k) ··5678", {
      beneficiaries: [
        { tier: "primary", who: spouse, percentage: 100 },
        { tier: "contingent", who: emma, percentage: 100 },
      ],
    });
    const book = hendricksBook({ ...kids, account: [k401], account_beneficiary_designation: [onRecord] });

    it("on an account on record: its id and the account as parent — and a blank tier keeps that tier's rows on record", () => {
      const row = rowOf("ret-1", { contingentBeneficiary: "Emma 50%, Lucas 50%" }, { link: linkedTo("k-1") });
      expect(place(RETIREMENT_MAP, [row], book).drafts[1]).toEqual({
        lineId: "ret-1/account_beneficiary_designation",
        sectionId: "retirement",
        rowId: "ret-1",
        target: "account_beneficiary_designation",
        recordId: "k-1",
        label: "Fidelity 401(k) ··5678 — beneficiaries",
        fields: [
          {
            key: "beneficiaries",
            value: [
              { tier: "primary", who: spouse, percentage: 100 },
              { tier: "contingent", who: emma, percentage: 50 },
              { tier: "contingent", who: lucas, percentage: 50 },
            ],
            from: [c("contingentBeneficiary")],
          },
        ],
        warnings: ["These beneficiaries replace the ones on record."],
        parent: { ref: "record", target: "account", id: "k-1" },
      });
    });

    it("the warning only when the record names someone (any tier) — with no one on record there's nothing to replace", () => {
      const row = rowOf("ret-1", { primaryBeneficiary: "Laura" }, { link: linkedTo("k-1") });
      const warningsWith = (beneficiaries: BookRecord["values"][string]) =>
        place(RETIREMENT_MAP, [row], hendricksBook({ ...kids, account: [k401], account_beneficiary_designation: [recordOf("k-1", "Fidelity 401(k) ··5678", { beneficiaries })] }))
          .drafts[1].warnings;
      expect(warningsWith([])).toEqual([]);
      expect(warningsWith([{ tier: "contingent", who: emma, percentage: 100 }])).toEqual(["These beneficiaries replace the ones on record."]);
    });

    it("both tiers blank: no beneficiaries line", () => {
      expect(place(RETIREMENT_MAP, [rowOf("ret-1", { currentValue: 420000 }, { link: linkedTo("k-1") })], book).drafts.map((d) => d.target)).toEqual(["account"]);
    });

    it("a name that doesn't resolve blocks the beneficiaries line, not the account", () => {
      const [account, names] = place(RETIREMENT_MAP, [rowOf("ret-1", { accountName: "Fidelity 401(k)", primaryBeneficiary: "Laura 50%, Olivia 50%" })]).drafts;
      expect(account.blocked).toBeUndefined();
      expect(names.fields).toEqual([]);
      expect(names.blocked).toEqual({ reason: 'No one named "Olivia" in this fact finder or on the plan.', cell: c("primaryBeneficiary") });
    });

    it("a trust or a charity can be a beneficiary", () => {
      const others = {
        entity: [recordOf("ent-1", "Hendricks Family Trust", { name: "Hendricks Family Trust" })],
        external_beneficiary: [recordOf("ext-1", "Red Cross", { name: "Red Cross" })],
      };
      const row = rowOf("ret-1", { accountName: "IRA", primaryBeneficiary: "Hendricks Family Trust 60%, Red Cross 40%" });
      expect(values(place(RETIREMENT_MAP, [row], hendricksBook(others)).drafts[1]).beneficiaries).toEqual([
        { tier: "primary", who: { ref: "record", target: "entity", id: "ent-1" }, percentage: 60 },
        { tier: "primary", who: { ref: "record", target: "external_beneficiary", id: "ext-1" }, percentage: 40 },
      ]);
    });
  });

  it("an owner the plan doesn't have blocks the account", () => {
    const [draft] = place(RETIREMENT_MAP, [rowOf("ret-1", { accountName: "Laura's IRA", owner: "Co-client" })], singleBook).drafts;
    expect(draft.blocked).toEqual({ reason: NO_CO_CLIENT_REASON, cell: c("owner") });
  });

  it("a row linked to a record not in the book never updates it — nor its beneficiaries", () => {
    const row = rowOf("ret-1", { accountName: "Fidelity 401(k)", primaryBeneficiary: "Laura" }, { link: linkedTo("k-of-another-client") });
    expect(place(RETIREMENT_MAP, [row]).drafts.map((d) => d.recordId)).toEqual([null, null]);
  });
});

describe("EDU_MAP", () => {
  const c = at("edu", "edu-1");

  it("a filled 529: a family member as beneficiary, an outside funder by name, and the 529 sub-type on a new account", () => {
    const row = rowOf("edu-1", {
      accountName: "Emma's 529", currentValue: 30000, basis: 20000, last4: "9012", owner: "Client",
      custodian: "Vanguard", beneficiary: "Emma", grantor: "Rose Hendricks",
    });
    expect(place(EDU_MAP, [row]).drafts).toEqual([
      {
        lineId: "edu-1/account",
        sectionId: "edu",
        rowId: "edu-1",
        target: "account",
        recordId: null,
        label: "Emma's 529 ··9012",
        fixed: { category: "education_savings", subType: "529" },
        fields: [
          { key: "name", value: "Emma's 529", from: [c("accountName")] },
          { key: "value", value: 30000, from: [c("currentValue")] },
          { key: "accountNumberLast4", value: "9012", from: [c("last4")] },
          { key: "custodian", value: "Vanguard", from: [c("custodian")] },
          { key: "basis", value: 20000, from: [c("basis")] },
          { key: "beneficiary", value: emma, from: [c("beneficiary")] },
          { key: "grantor", value: "Rose Hendricks", from: [c("grantor")] },
        ],
        warnings: [],
      },
    ]);
  });

  it("a grantor in the household is that person", () => {
    const [draft] = place(EDU_MAP, [rowOf("edu-1", { beneficiary: "Lucas", grantor: "Laura" })]).drafts;
    expect(values(draft)).toEqual({ beneficiary: lucas, grantor: spouse });
  });

  describe("Owner fills a blank Grantor", () => {
    it("Client or Co-client → that person", () => {
      const mine = place(EDU_MAP, [rowOf("edu-1", { beneficiary: "Emma", owner: "Client" })]).drafts[0];
      expect(mine.fields[1]).toEqual({ key: "grantor", value: client, from: [c("owner")] });
      expect(values(place(EDU_MAP, [rowOf("edu-1", { beneficiary: "Emma", owner: "Co-client" })]).drafts[0]).grantor).toEqual(spouse);
    });

    it("Joint or a trust → no grantor, and a warning", () => {
      for (const owner of ["Joint", "Trust / entity"]) {
        const [draft] = place(EDU_MAP, [rowOf("edu-1", { beneficiary: "Emma", owner })]).drafts;
        expect(keysOf(draft)).toEqual(["beneficiary"]);
        expect(draft.warnings).toEqual(["A 529 has no owner on the plan — pick who funded it under Grantor."]);
      }
    });

    it("never over a grantor on record", () => {
      const college = accountRecord("e-1", "Emma's 529", { name: "Emma's 529", beneficiary: emma, grantor: "Rose Hendricks" }, { category: "education_savings", subType: "529" });
      const [draft] = place(EDU_MAP, [rowOf("edu-1", { owner: "Client" }, { link: linkedTo("e-1") })], hendricksBook({ ...kids, account: [college] })).drafts;
      expect(draft.fields).toEqual([]);
      expect(draft.warnings).toEqual([]);

      const unfunded = accountRecord("e-1", "Emma's 529", { name: "Emma's 529", beneficiary: emma, grantor: null }, { category: "education_savings", subType: "529" });
      const [fills] = place(EDU_MAP, [rowOf("edu-1", { owner: "Client" }, { link: linkedTo("e-1") })], hendricksBook({ ...kids, account: [unfunded] })).drafts;
      expect(fills.fields).toEqual([{ key: "grantor", value: client, from: [c("owner")] }]);
    });
  });

  it("a new 529 needs its beneficiary; one on record already has it", () => {
    const [draft] = place(EDU_MAP, [rowOf("edu-1", { accountName: "College Fund" })]).drafts;
    expect(draft.blocked).toEqual({ reason: "A 529 needs its beneficiary (the student).", cell: c("beneficiary") });

    const college = accountRecord("e-1", "Emma's 529", { name: "Emma's 529", beneficiary: emma }, { category: "education_savings", subType: "529" });
    const [linked] = place(EDU_MAP, [rowOf("edu-1", { currentValue: 31000 }, { link: linkedTo("e-1") })], hendricksBook({ ...kids, account: [college] })).drafts;
    expect(linked.blocked).toBeUndefined();
  });

  it("a beneficiary no one in the household is saved as the name; two matches block", () => {
    expect(values(place(EDU_MAP, [rowOf("edu-1", { beneficiary: "Sophie Hendricks" })]).drafts[0])).toEqual({ beneficiary: "Sophie Hendricks" });

    const twoEmmas = hendricksBook({
      family_member: [...kids.family_member, recordOf("fm-emma-2", "Emma Stone", { firstName: "Emma", lastName: "Stone" })],
    });
    const [draft] = place(EDU_MAP, [rowOf("edu-1", { beneficiary: "Emma" })], twoEmmas).drafts;
    expect(draft.fields).toEqual([]);
    expect(draft.blocked).toEqual({ reason: 'Two people match "Emma" — use the full name.', cell: c("beneficiary") });
  });

  it("holdings ride along, as on any account with positions", () => {
    const row = rowOf("edu-1", { beneficiary: "Emma" }, { holdings: [holding("h1", { name: "Target 2035", marketValue: 30000, costBasis: 20000 })] });
    expect(keysOf(place(EDU_MAP, [row]).drafts[0])).toEqual(["beneficiary", "holdings"]);
  });
});
