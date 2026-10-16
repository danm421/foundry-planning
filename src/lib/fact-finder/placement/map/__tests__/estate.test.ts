// src/lib/fact-finder/placement/map/__tests__/estate.test.ts
import { describe, expect, it } from "vitest";
import { findSection } from "../../../schema";
import type { FFRow } from "../../../types";
import { bookWith, contextOf, hendricksBook, linkedTo, recordOf, rowOf, stateWith } from "../../__tests__/fixtures";
import { diffDrafts } from "../../diff";
import { NO_CO_CLIENT_REASON } from "../../refs";
import type { BookRecord, RecordBook, TargetDraft } from "../../types";
import { BEQUESTS_MAP, ESTATE_DOCS_MAP, FINAL_NOTES_MAP, GIFTS_MAP, TRUSTS_MAP } from "../estate";
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
const docs = (label: "Client" | "Co-client", cells: Parameters<typeof rowOf>[1]) => rowOf(`estate_docs:${label}`, cells);
const NOTE = { section: "observation", audience: "advisor", source: "manual" };

describe("placements", () => {
  it.each([ESTATE_DOCS_MAP, TRUSTS_MAP, BEQUESTS_MAP, GIFTS_MAP, FINAL_NOTES_MAP])("$sectionId declares every column exactly once", (map) => {
    expect(Object.keys(map.placements).sort()).toEqual(findSection(map.sectionId)!.columns.map((c) => c.id).sort());
  });

  it("the Documents in Place trust checks are context, and the closing notes box is a note for the AI step", () => {
    for (const id of ["revocableTrust", "ilit", "idgt", "clt", "crt", "otherIrrevocable"]) {
      expect(ESTATE_DOCS_MAP.placements[id]).toEqual({ context: "A trust is created from the Trusts section, which names it." });
    }
    expect(FINAL_NOTES_MAP.placements).toEqual({ notes: { note: "general" } });
    expect(place(FINAL_NOTES_MAP, [rowOf("final_notes:Notes", { notes: "Mark's mother may move in with them." })]).drafts).toEqual([]);
  });
});

describe("ESTATE_DOCS_MAP", () => {
  const c = at("estate_docs", "estate_docs:Client");
  const cc = at("estate_docs", "estate_docs:Co-client");

  it("a filled Client row: a will to create, the last-updated plan note and the estate attorney — trusts come from the Trusts section", () => {
    const row = docs("Client", { will: true, revocableTrust: true, ilit: true, lastUpdatedYear: 2019, estateAttorney: "Jane Smith, Smith & Co" });
    const trusts = [
      rowOf("t1", { trustName: "Hendricks Family Trust", trustType: "Revocable living trust" }),
      rowOf("t2", { trustName: "Hendricks ILIT", trustType: "ILIT" }),
    ];
    const { drafts, notices } = place(ESTATE_DOCS_MAP, [row], hendricksBook(kids), { trusts });
    expect(drafts).toEqual([
      {
        lineId: "estate_docs:Client/will",
        sectionId: "estate_docs",
        rowId: "estate_docs:Client",
        target: "will",
        recordId: null,
        label: "Mark's will",
        fields: [{ key: "grantor", value: "client", from: [c("will")] }],
        warnings: [],
      },
      {
        lineId: "estate_docs:Client/plan_observation",
        sectionId: "estate_docs",
        rowId: "estate_docs:Client",
        target: "plan_observation",
        recordId: null,
        label: "Plan note: Client's will was last updated in 2019.",
        fixed: NOTE,
        fields: [
          { key: "topic", value: "estate", from: [c("lastUpdatedYear")] },
          { key: "body", value: "Client's will was last updated in 2019.", from: [c("lastUpdatedYear")] },
        ],
        warnings: [],
      },
      {
        lineId: "estate_docs:Client/related_party",
        sectionId: "estate_docs",
        rowId: "estate_docs:Client",
        target: "related_party",
        recordId: null,
        label: "Estate attorney — Jane Smith",
        fixed: { relationshipLabel: "Estate attorney" },
        fields: [
          { key: "firstName", value: "Jane", from: [c("estateAttorney")] },
          { key: "lastName", value: "Smith", from: [c("estateAttorney")] },
          { key: "employer", value: "Smith & Co", from: [c("estateAttorney")] },
        ],
        warnings: [],
      },
    ]);
    expect(notices).toEqual([]);
  });

  it("no will line here when the person's will is on record, or when Will Provisions rows name their will (that map makes it)", () => {
    const row = docs("Client", { will: true });
    const onRecord = hendricksBook({ will: [recordOf("w-1", "Mark's will", { grantor: "client" }, { grantor: "client" })] });
    expect(place(ESTATE_DOCS_MAP, [row], onRecord).drafts).toEqual([]);
    const mine = rowOf("b1", { willOf: "Client", gift: "Remaining estate", recipients: "Laura" });
    expect(place(ESTATE_DOCS_MAP, [row], hendricksBook(kids), { bequests: [mine] }).drafts).toEqual([]);
    const theirs = rowOf("b1", { willOf: "Co-client", gift: "Remaining estate", recipients: "Mark" });
    expect(place(ESTATE_DOCS_MAP, [row], hendricksBook(kids), { bequests: [theirs] }).drafts.map((d) => d.lineId)).toEqual(["estate_docs:Client/will"]);
  });

  it("the co-client's will needs a co-client", () => {
    expect(place(ESTATE_DOCS_MAP, [docs("Co-client", { will: true })], bookWith({})).drafts).toEqual([
      {
        lineId: "estate_docs:Co-client/will",
        sectionId: "estate_docs",
        rowId: "estate_docs:Co-client",
        target: "will",
        recordId: null,
        label: "Co-client's will",
        fields: [{ key: "grantor", value: "spouse", from: [cc("will")] }],
        warnings: [],
        blocked: { reason: NO_CO_CLIENT_REASON, cell: cc("will") },
      },
    ]);
  });

  it("Last updated without Will checked dates the estate documents — and the same note on record is that record", () => {
    const body = "Co-client's estate documents were last updated in 2015.";
    const book = hendricksBook({ plan_observation: [recordOf("obs-1", body, { topic: "estate", body })] });
    const [note] = place(ESTATE_DOCS_MAP, [docs("Co-client", { lastUpdatedYear: 2015 })], book).drafts;
    expect(note.lineId).toBe("estate_docs:Co-client/plan_observation");
    expect(note.recordId).toBe("obs-1");
    expect(values(note)).toEqual({ topic: "estate", body });
    expect(place(ESTATE_DOCS_MAP, [docs("Co-client", { lastUpdatedYear: 2016 })], book).drafts[0].recordId).toBeNull();
  });

  describe("estate attorney", () => {
    it("both people naming one attorney make one line from both cells; Esq. and Jr. are neither name nor firm", () => {
      const rows = [docs("Client", { estateAttorney: "Jane Smith, Esq., Smith & Co" }), docs("Co-client", { estateAttorney: "jane smith" })];
      const { drafts } = place(ESTATE_DOCS_MAP, rows);
      expect(drafts).toHaveLength(1);
      expect(drafts[0].fields).toEqual([
        { key: "firstName", value: "Jane", from: [c("estateAttorney"), cc("estateAttorney")] },
        { key: "lastName", value: "Smith", from: [c("estateAttorney"), cc("estateAttorney")] },
        { key: "employer", value: "Smith & Co", from: [c("estateAttorney")] },
      ]);
      expect(values(place(ESTATE_DOCS_MAP, [docs("Client", { estateAttorney: "John Doe Jr." })]).drafts[0])).toEqual({ firstName: "John", lastName: "Doe" });
    });

    it("two attorneys make two lines; one on record (same first and last name) is that record", () => {
      const book = hendricksBook({ related_party: [recordOf("rp-1", "Jane Smith", { firstName: "Jane", lastName: "Smith", employer: "Smith & Co" })] });
      const rows = [docs("Client", { estateAttorney: "Jane Smith" }), docs("Co-client", { estateAttorney: "Ann Lee, Lee Law" })];
      const { drafts } = place(ESTATE_DOCS_MAP, rows, book);
      expect(drafts.map((d) => [d.lineId, d.recordId, d.label])).toEqual([
        ["estate_docs:Client/related_party", "rp-1", "Estate attorney — Jane Smith"],
        ["estate_docs:Co-client/related_party", null, "Estate attorney — Ann Lee"],
      ]);
    });

    const NEEDS_NAME = "Estate attorney: give the attorney's first and last name.";

    it("one word is blocked — it needs a first and a last name; the firm after the comma is kept", () => {
      const [d] = place(ESTATE_DOCS_MAP, [docs("Client", { estateAttorney: "Smith, Smith & Co" })]).drafts;
      expect(d.blocked).toEqual({ reason: NEEDS_NAME, cell: c("estateAttorney") });
      expect(d.fields).toEqual([{ key: "employer", value: "Smith & Co", from: [c("estateAttorney")] }]);
    });

    it.each([
      "Smith & Co", "Baker McKenzie LLP", "Law Offices of Jane Smith", "Jane Smith (Smith & Co)", "Jane Smith [Smith Law]",
      "Hart LLC", "Hart PLLC", "Jones PC", "Jones P.C.", "Ann Gray P.A.", "Lee Associates", "Doe Legal Group", "The Hart Firm",
    ])('"%s" names a firm, not a person: kept as the employer, and the line asks for the attorney\'s name', (value) => {
      const [d] = place(ESTATE_DOCS_MAP, [docs("Client", { estateAttorney: value })]).drafts;
      expect(d.fields).toEqual([{ key: "employer", value, from: [c("estateAttorney")] }]);
      expect(d.blocked).toEqual({ reason: NEEDS_NAME, cell: c("estateAttorney") });
    });

    it("a name before the comma has no firm marker, so it still splits — the firm after it is the employer", () => {
      const [d] = place(ESTATE_DOCS_MAP, [docs("Client", { estateAttorney: "Jane Smith, Smith & Co" })]).drafts;
      expect(values(d)).toEqual({ firstName: "Jane", lastName: "Smith", employer: "Smith & Co" });
      expect(d.blocked).toBeUndefined();
    });
  });

  it("a trust checked here with none in the Trusts section or on the plan is a notice, not a line", () => {
    const rows = [docs("Client", { ilit: true, clt: true, idgt: true, revocableTrust: true }), docs("Co-client", { ilit: true, otherIrrevocable: true, crt: false })];
    const book = hendricksBook({
      entity: [recordOf("ent-1", "Charitable Lead Trust", { name: "Charitable Lead Trust" }, { trustSubType: "clt" })],
      revocable_trust: [recordOf("rlt-1", "Hendricks Family Trust", { name: "Hendricks Family Trust" })],
    });
    const { drafts, notices } = place(ESTATE_DOCS_MAP, rows, book, { trusts: [rowOf("t1", { trustName: "Hendricks IDGT", trustType: "IDGT" })] });
    expect(drafts).toEqual([]);
    expect(notices).toEqual([
      "Documents in Place says the client and co-client have an ILIT, but the Trusts section lists none — add it there to save it.",
      "Documents in Place says the co-client has an irrevocable trust, but the Trusts section lists none — add it there to save it.",
    ]);
  });
});

describe("TRUSTS_MAP", () => {
  const c = at("trusts", "t1");
  const SPLIT = "A charitable lead or remainder trust needs its split-interest terms — add it in Details.";

  it("a filled trust: the entity with its fixed type, and its beneficiaries as a second line hanging off it", () => {
    const row = rowOf("t1", {
      trustName: "Hendricks ILIT", trustType: "ILIT", grantor: "Client", trustee: "Jane Smith", grantorTrust: "No", crummey: "Yes",
      trustEnds: "At second death", incomeBeneficiaries: "Laura", remainderBeneficiaries: "Emma 50%, Lucas 50%",
    });
    expect(place(TRUSTS_MAP, [row]).drafts).toEqual([
      {
        lineId: "t1/entity",
        sectionId: "trusts",
        rowId: "t1",
        target: "entity",
        recordId: null,
        label: "Hendricks ILIT",
        fixed: { entityType: "trust", isIrrevocable: true },
        fields: [
          { key: "name", value: "Hendricks ILIT", from: [c("trustName")] },
          { key: "trustSubType", value: "ilit", from: [c("trustType")] },
          { key: "grantor", value: "client", from: [c("grantor")] },
          { key: "trustee", value: "Jane Smith", from: [c("trustee")] },
          { key: "isGrantor", value: false, from: [c("grantorTrust")] },
          { key: "crummeyPowers", value: true, from: [c("crummey")] },
          { key: "trustEnds", value: "survivorship", from: [c("trustEnds")] },
        ],
        warnings: [],
      },
      {
        lineId: "t1/trust_beneficiary_designation",
        sectionId: "trusts",
        rowId: "t1",
        target: "trust_beneficiary_designation",
        recordId: null,
        label: "Hendricks ILIT — beneficiaries",
        fields: [
          {
            key: "beneficiaries",
            value: [
              { tier: "income", who: spouse, percentage: 100 },
              { tier: "remainder", who: emma, percentage: 50 },
              { tier: "remainder", who: lucas, percentage: 50 },
            ],
            from: [c("incomeBeneficiaries"), c("remainderBeneficiaries")],
          },
        ],
        warnings: [],
        parent: { ref: "line", target: "entity", lineId: "t1/entity" },
        dependsOn: ["t1/entity"],
      },
    ]);
  });

  it('grantor "Someone else" is "none"; a blank cell makes no field, and no beneficiaries make no second line', () => {
    const { drafts } = place(TRUSTS_MAP, [rowOf("t1", { trustName: "Dynasty Trust", grantor: "Someone else", trustee: null, incomeBeneficiaries: "" })]);
    expect(drafts).toHaveLength(1);
    expect(values(drafts[0])).toEqual({ name: "Dynasty Trust", grantor: "none" });
  });

  it("a trust from the co-client needs a co-client", () => {
    const row = rowOf("t1", { trustName: "Laura's Trust", trustType: "Irrevocable", grantor: "Co-client" });
    expect(place(TRUSTS_MAP, [row], bookWith({})).drafts[0].blocked).toEqual({ reason: NO_CO_CLIENT_REASON, cell: c("grantor") });
    expect(place(TRUSTS_MAP, [row]).drafts[0].blocked).toBeUndefined();
  });

  it("a revocable living trust saves its name only — matched on record by name — and says what it leaves out", () => {
    const row = rowOf("t1", {
      trustName: "Hendricks Family Trust", trustType: "Revocable living trust", grantor: "Client", trustee: "Mark Hendricks", remainderBeneficiaries: "Emma",
    });
    expect(place(TRUSTS_MAP, [row]).drafts).toEqual([
      {
        lineId: "t1/revocable_trust",
        sectionId: "trusts",
        rowId: "t1",
        target: "revocable_trust",
        recordId: null,
        label: "Hendricks Family Trust",
        fields: [{ key: "name", value: "Hendricks Family Trust", from: [c("trustName")] }],
        warnings: ['These aren\'t saved for a revocable living trust: "Grantor", "Trustee", "Remainder beneficiaries".'],
      },
    ]);
    const book = hendricksBook({ revocable_trust: [recordOf("rlt-1", "Hendricks Family Trust", { name: "Hendricks Family Trust" })] });
    const named = rowOf("t1", { trustName: "hendricks family trust", trustType: "Revocable living trust" });
    expect(place(TRUSTS_MAP, [named], book).drafts[0].recordId).toBe("rlt-1");
  });

  it("a new charitable lead or remainder trust is blocked (its beneficiaries hang off it); one on record keeps its terms", () => {
    const [trust, names] = place(TRUSTS_MAP, [rowOf("t1", { trustName: "Hendricks CLT", trustType: "CLT", remainderBeneficiaries: "Emma" })]).drafts;
    expect(trust.blocked).toEqual({ reason: SPLIT, cell: c("trustType") });
    expect(names.parent).toEqual({ ref: "line", target: "entity", lineId: "t1/entity" });
    const book = hendricksBook({ entity: [recordOf("ent-1", "Hendricks CRT", { name: "Hendricks CRT" }, { trustSubType: "crt" })] });
    const same = place(TRUSTS_MAP, [rowOf("t1", { trustName: "Hendricks CRT", trustType: "CRT", trustee: "Jane Smith" }, { link: linkedTo("ent-1") })], book).drafts[0];
    expect(same.recordId).toBe("ent-1");
    expect(same.blocked).toBeUndefined();
    const becoming = place(TRUSTS_MAP, [rowOf("t1", { trustName: "Hendricks CRT", trustType: "CLT" }, { link: linkedTo("ent-1") })], book).drafts[0];
    expect(becoming.blocked).toEqual({ reason: SPLIT, cell: c("trustType") });
  });

  it("a charitable lead or remainder trust on record keeps its grantor: a different one is left off the line, which says where it changes — its other fields still save", () => {
    const GRANTOR = "A charitable lead or remainder trust's grantor changes in Details — its remainder gift moves with it.";
    const clt = recordOf("ent-1", "Hendricks CLT", { name: "Hendricks CLT", trustSubType: "clt", grantor: "client", trustee: "Jane Smith" }, { trustSubType: "clt" });
    const crt = recordOf("ent-2", "Hendricks CRT", { name: "Hendricks CRT", trustSubType: "crt", grantor: "none", trustee: "Jane Smith" }, { trustSubType: "crt" });
    const ilit = recordOf("ent-3", "Hendricks ILIT", { name: "Hendricks ILIT", trustSubType: "ilit", grantor: "client", trustee: "Jane Smith" }, { trustSubType: "ilit" });
    const lineOf = (book: RecordBook, recordId: string, cells: Parameters<typeof rowOf>[1]) =>
      diffDrafts(place(TRUSTS_MAP, [rowOf("t1", { trustee: "Denver Foundation", ...cells }, { link: linkedTo(recordId) })], book).drafts, book)[0];
    const keysAndWarnings = (line: ReturnType<typeof lineOf>) => ({ keys: line.fields.map((f) => f.key), warnings: line.warnings, blocked: line.blocked });

    const book = hendricksBook({ entity: [clt, crt, ilit] });
    expect(keysAndWarnings(lineOf(book, "ent-1", { trustType: "CLT", grantor: "Co-client" }))).toEqual({ keys: ["trustee"], warnings: [GRANTOR], blocked: undefined });
    expect(keysAndWarnings(lineOf(book, "ent-1", { grantor: "Someone else" }))).toEqual({ keys: ["trustee"], warnings: [GRANTOR], blocked: undefined });
    expect(keysAndWarnings(lineOf(book, "ent-2", { trustType: "CRT", grantor: "Client" }))).toEqual({ keys: ["trustee"], warnings: [GRANTOR], blocked: undefined });
    // A grantor the plan has no co-client for isn't saved, so it blocks nothing.
    const single = bookWith({ entity: [clt] }, { people: { client: "fm-client", spouse: null }, names: { client: "Mark", spouse: null } });
    expect(keysAndWarnings(lineOf(single, "ent-1", { grantor: "Co-client" }))).toEqual({ keys: ["trustee"], warnings: [GRANTOR], blocked: undefined });
    // The grantor on record: nothing to say. Any other trust takes a new grantor.
    expect(keysAndWarnings(lineOf(book, "ent-1", { grantor: "Client" }))).toEqual({ keys: ["trustee"], warnings: [], blocked: undefined });
    expect(keysAndWarnings(lineOf(book, "ent-3", { grantor: "Co-client" }))).toEqual({ keys: ["grantor", "trustee"], warnings: [], blocked: undefined });
  });

  it("on a trust on record: its id for both lines — and a blank tier keeps that tier's beneficiaries on record", () => {
    const book = hendricksBook({
      ...kids,
      entity: [recordOf("ent-1", "Hendricks ILIT", { name: "Hendricks ILIT" }, { trustSubType: "ilit" })],
      trust_beneficiary_designation: [
        recordOf("ent-1", "Hendricks ILIT", { beneficiaries: [{ tier: "income", who: spouse, percentage: 100 }, { tier: "remainder", who: emma, percentage: 100 }] }),
      ],
    });
    const row = rowOf("t1", { trustName: "Hendricks ILIT", remainderBeneficiaries: "Emma 50%, Lucas 50%" }, { link: linkedTo("ent-1") });
    const [trust, names] = place(TRUSTS_MAP, [row], book).drafts;
    expect(trust.recordId).toBe("ent-1");
    expect(names).toEqual({
      lineId: "t1/trust_beneficiary_designation",
      sectionId: "trusts",
      rowId: "t1",
      target: "trust_beneficiary_designation",
      recordId: "ent-1",
      label: "Hendricks ILIT — beneficiaries",
      fields: [
        {
          key: "beneficiaries",
          value: [
            { tier: "income", who: spouse, percentage: 100 },
            { tier: "remainder", who: emma, percentage: 50 },
            { tier: "remainder", who: lucas, percentage: 50 },
          ],
          from: [c("remainderBeneficiaries")],
        },
      ],
      warnings: [],
      parent: { ref: "record", target: "entity", id: "ent-1" },
    });
    // The line says it replaces the set on record.
    expect(diffDrafts([trust, names], book)[1].warnings).toEqual(["These beneficiaries replace the ones on record."]);
  });

  it("the warning only when the record names someone (any tier) — with no one on record there's nothing to replace", () => {
    const row = rowOf("t1", { trustName: "Hendricks ILIT", incomeBeneficiaries: "Laura" }, { link: linkedTo("ent-1") });
    const warningsWith = (beneficiaries: BookRecord["values"][string]) => {
      const withSet = hendricksBook({
        ...kids,
        entity: [recordOf("ent-1", "Hendricks ILIT", { name: "Hendricks ILIT" }, { trustSubType: "ilit" })],
        trust_beneficiary_designation: [recordOf("ent-1", "Hendricks ILIT", { beneficiaries })],
      });
      return diffDrafts(place(TRUSTS_MAP, [row], withSet).drafts, withSet)[1].warnings;
    };
    expect(warningsWith([])).toEqual([]);
    expect(warningsWith([{ tier: "remainder", who: emma, percentage: 100 }])).toEqual(["These beneficiaries replace the ones on record."]);
  });

  it("a name that doesn't resolve blocks the beneficiaries line, not the trust", () => {
    const [trust, names] = place(TRUSTS_MAP, [rowOf("t1", { trustName: "Hendricks ILIT", incomeBeneficiaries: "Olivia" })]).drafts;
    expect(trust.blocked).toBeUndefined();
    expect(names.fields).toEqual([]);
    expect(names.blocked).toEqual({ reason: 'No one named "Olivia" in this fact finder or on the plan.', cell: c("incomeBeneficiaries") });
  });

  it("a row linked to a record not in the book never updates it", () => {
    const { drafts } = place(TRUSTS_MAP, [rowOf("t1", { trustName: "Hendricks ILIT", incomeBeneficiaries: "Laura" }, { link: linkedTo("ent-of-another-client") })]);
    expect(drafts.map((d) => d.recordId)).toEqual([null, null]);
    expect(drafts[1].warnings).toEqual([]);
  });
});

describe("BEQUESTS_MAP", () => {
  const c = (rowId: string) => at("bequests", rowId);
  const docsCell = at("estate_docs", "estate_docs:Client");
  const newWill = { ref: "line", target: "will", lineId: "estate_docs:Client/will" } as const;
  const accounts = { taxable: [rowOf("tx-1", { accountName: "Joint Brokerage" })], liab: [rowOf("liab-1", { loanName: "Chase Visa" })] };
  const OTHERS_STAY = "Saving changes only the provisions listed here; the will's other provisions stay.";

  it("a new will's provisions: the will line on the Documents in Place row, a specific asset, a debt and the remaining estate", () => {
    const rows = [
      rowOf("b1", { willOf: "Client", gift: "Specific asset", asset: "Joint Brokerage", percent: 50, recipients: "Emma 50%, Lucas 50%", condition: "Always" }),
      rowOf("b2", { willOf: "Client", gift: "Debt (who pays)", asset: "Chase Visa", recipients: "Emma" }),
      rowOf("b3", { willOf: "Client", gift: "Remaining estate", recipients: "Laura" }),
    ];
    const { drafts } = place(BEQUESTS_MAP, rows, hendricksBook(kids), { ...accounts, estate_docs: [docs("Client", { will: true })] });
    expect(drafts).toEqual([
      {
        lineId: "estate_docs:Client/will",
        sectionId: "estate_docs",
        rowId: "estate_docs:Client",
        target: "will",
        recordId: null,
        label: "Mark's will",
        fields: [{ key: "grantor", value: "client", from: [docsCell("will"), c("b1")("willOf"), c("b2")("willOf"), c("b3")("willOf")] }],
        warnings: [],
      },
      {
        lineId: "b1/will_bequest",
        sectionId: "bequests",
        rowId: "b1",
        target: "will_bequest",
        recordId: null,
        label: "Mark's will — Joint Brokerage",
        fixed: { name: "Joint Brokerage", sortOrder: 0 },
        fields: [
          { key: "kind", value: "asset", from: [c("b1")("gift")], with: { assetMode: "specific" } },
          { key: "accountId", value: { ref: "line", target: "account", lineId: "tx-1/account" }, from: [c("b1")("asset")] },
          { key: "percentage", value: 50, from: [c("b1")("percent")] },
          { key: "recipients", value: [{ who: emma, percentage: 50 }, { who: lucas, percentage: 50 }], from: [c("b1")("recipients")] },
          { key: "condition", value: "always", from: [c("b1")("condition")] },
        ],
        warnings: [],
        parent: newWill,
        dependsOn: ["estate_docs:Client/will", "tx-1/account"],
      },
      {
        lineId: "b2/will_bequest",
        sectionId: "bequests",
        rowId: "b2",
        target: "will_bequest",
        recordId: null,
        label: "Mark's will — Chase Visa",
        fixed: { name: "Chase Visa", sortOrder: 1 },
        fields: [
          { key: "kind", value: "liability", from: [c("b2")("gift")] },
          { key: "liabilityId", value: { ref: "line", target: "liability", lineId: "liab-1/liability" }, from: [c("b2")("asset")] },
          { key: "recipients", value: [{ who: emma, percentage: 100 }], from: [c("b2")("recipients")] },
          { key: "condition", value: "always", from: [] },
        ],
        warnings: [],
        parent: newWill,
        dependsOn: ["estate_docs:Client/will", "liab-1/liability"],
      },
      {
        lineId: "b3/will_residuary_recipient",
        sectionId: "bequests",
        rowId: "b3",
        target: "will_residuary_recipient",
        recordId: null,
        label: "Mark's will — remaining estate",
        fields: [{ key: "recipients", value: [{ who: spouse, percentage: 100 }], from: [c("b3")("recipients")] }],
        warnings: [],
        parent: newWill,
        dependsOn: ["estate_docs:Client/will"],
      },
    ]);
  });

  it("a new provision with no % of it gives all of it, always; on a provision on record a blank changes nothing", () => {
    const row = rowOf("b1", { willOf: "Client", gift: "Specific asset", asset: "Joint Brokerage", recipients: "Emma" });
    const [, fresh] = place(BEQUESTS_MAP, [row], hendricksBook(kids), accounts).drafts;
    expect(fresh.fields.filter((f) => f.key === "percentage" || f.key === "condition")).toEqual([
      { key: "percentage", value: 100, from: [] },
      { key: "condition", value: "always", from: [] },
    ]);
    const book = hendricksBook({
      ...kids,
      account: [recordOf("a-1", "Joint Brokerage", { name: "Joint Brokerage" }, { category: "taxable" })],
      will: [recordOf("w-1", "Mark's will", { grantor: "client" }, { grantor: "client" })],
      will_bequest: [recordOf("bq-1", "Joint Brokerage", { condition: "if_spouse_survives" }, { willId: "w-1", grantor: "client", assetKey: "account:a-1" })],
    });
    const [onRecord] = place(BEQUESTS_MAP, [row], book).drafts;
    expect(onRecord.recordId).toBe("bq-1");
    expect(values(onRecord)).toEqual({ kind: "asset", accountId: { ref: "record", target: "account", id: "a-1" }, recipients: [{ who: emma, percentage: 100 }] });
  });

  it("a will on record: provisions hang off it, each matching its own record by asset (same condition first), and the rest stay", () => {
    const bequest = (id: string, condition: string) =>
      recordOf(id, "Brokerage", { kind: "asset", condition }, { willId: "w-1", grantor: "client", assetKey: "account:a-1" });
    const book = hendricksBook({
      ...kids,
      account: [recordOf("a-1", "Brokerage", { name: "Brokerage" }, { category: "taxable" })],
      will: [recordOf("w-1", "Mark's will", { grantor: "client" }, { grantor: "client" })],
      will_bequest: [bequest("bq-1", "if_spouse_predeceased"), bequest("bq-2", "if_spouse_survives")],
      will_residuary_recipient: [recordOf("w-1", "Mark's will — remaining estate", { recipients: [{ who: spouse, percentage: 100 }] })],
    });
    const rows = [
      rowOf("b1", { willOf: "Client", gift: "Specific asset", asset: "Brokerage", recipients: "Laura", condition: "If co-client survives" }),
      rowOf("b2", { willOf: "Client", gift: "Specific asset", asset: "Brokerage", recipients: "Emma", condition: "If co-client predeceases" }),
      rowOf("b3", { willOf: "Client", gift: "Remaining estate", recipients: "Emma 50%, Lucas 50%" }),
    ];
    const { drafts } = place(BEQUESTS_MAP, rows, book);
    const onRecord = { ref: "record", target: "will", id: "w-1" };
    expect(drafts.map((d) => [d.lineId, d.recordId, d.parent, d.dependsOn, d.warnings])).toEqual([
      ["b1/will_bequest", "bq-2", onRecord, undefined, [OTHERS_STAY]],
      ["b2/will_bequest", "bq-1", onRecord, undefined, [OTHERS_STAY]],
      ["b3/will_residuary_recipient", "w-1", onRecord, undefined, []],
    ]);
    // The remaining estate's line says it replaces the set on record.
    expect(diffDrafts(drafts, book)[2].warnings).toEqual(["These recipients replace the ones on record."]);
  });

  describe("two provisions on record give one asset", () => {
    const bequest = (id: string, condition: string) =>
      recordOf(id, "Fidelity IRA", { kind: "asset", condition }, { willId: "w-1", grantor: "client", assetKey: "account:a-ira" });
    const book = hendricksBook({
      ...kids,
      account: [recordOf("a-ira", "Fidelity IRA", { name: "Fidelity IRA" }, { category: "retirement" })],
      will: [recordOf("w-1", "Mark's will", { grantor: "client" }, { grantor: "client" })],
      // The kids' provision first: a greedy match hands it to the blank row, and the row naming it gets Laura's.
      will_bequest: [bequest("bq-kids", "if_spouse_predeceased"), bequest("bq-laura", "if_spouse_survives")],
    });
    const ira = (id: string, recipients: string, condition?: string) =>
      rowOf(id, { willOf: "Client", gift: "Specific asset", asset: "Fidelity IRA", recipients, ...(condition ? { condition } : {}) });

    it("a row naming its condition takes that provision first, even when a blank row comes before it", () => {
      const { drafts } = place(BEQUESTS_MAP, [ira("b1", "Laura"), ira("b2", "Emma 50%, Lucas 50%", "If co-client predeceases")], book);
      expect(drafts.map((d) => [d.lineId, d.recordId, d.blocked])).toEqual([
        ["b1/will_bequest", "bq-laura", undefined],
        ["b2/will_bequest", "bq-kids", undefined],
      ]);
      expect(values(drafts[0]).condition).toBeUndefined();
    });

    it("a blank Condition with both still to choose from is blocked on its Condition cell", () => {
      const [draft] = place(BEQUESTS_MAP, [ira("b1", "Laura")], book).drafts;
      expect(draft.blocked).toEqual({ reason: "Two provisions on record give Fidelity IRA — pick a Condition.", cell: c("b1")("condition") });
    });

    it("a Condition that matches neither is blocked, and neither record is rewritten", () => {
      const { drafts } = place(BEQUESTS_MAP, [ira("b1", "Emma, Lucas", "Always")], book);
      expect(drafts.map((d) => [d.recordId, d.blocked])).toEqual([
        [null, { reason: "Two provisions on record give Fidelity IRA, neither with this Condition — pick one of theirs.", cell: c("b1")("condition") }],
      ]);
    });

    it("with exactly one provision left, a different Condition still updates that record", () => {
      const one = hendricksBook({
        ...kids,
        account: [recordOf("a-ira", "Fidelity IRA", { name: "Fidelity IRA" }, { category: "retirement" })],
        will: [recordOf("w-1", "Mark's will", { grantor: "client" }, { grantor: "client" })],
        will_bequest: [bequest("bq-laura", "if_spouse_survives")],
      });
      const [draft] = place(BEQUESTS_MAP, [ira("b1", "Emma, Lucas", "Always")], one).drafts;
      expect(draft.recordId).toBe("bq-laura");
      expect(draft.blocked).toBeUndefined();
    });
  });

  it("the remaining estate warns it replaces the set only when the will on record names someone", () => {
    const row = rowOf("b1", { willOf: "Client", gift: "Remaining estate", recipients: "Emma" });
    const warningsWith = (recipients: BookRecord["values"][string]) => {
      const withSet = hendricksBook({
        ...kids,
        will: [recordOf("w-1", "Mark's will", { grantor: "client" }, { grantor: "client" })],
        will_residuary_recipient: [recordOf("w-1", "Mark's will — remaining estate", { recipients })],
      });
      return diffDrafts(place(BEQUESTS_MAP, [row], withSet).drafts, withSet)[0].warnings;
    };
    expect(warningsWith([])).toEqual([]);
    expect(warningsWith([{ who: spouse, percentage: 100 }])).toEqual(["These recipients replace the ones on record."]);
  });

  it("the remaining estate: every row of one will makes one set, each row's % of it scaling its shares; asset and condition aren't saved", () => {
    const rows = [
      rowOf("b1", { willOf: "Client", gift: "Remaining estate", percent: 60, recipients: "Laura" }),
      rowOf("b2", { willOf: "Client", gift: "Remaining estate", percent: 40, recipients: "Emma 50%, Lucas 50%", asset: "Brokerage", condition: "If co-client survives" }),
    ];
    const [, rest] = place(BEQUESTS_MAP, rows).drafts;
    expect(rest.lineId).toBe("b1/will_residuary_recipient");
    expect(rest.fields).toEqual([
      {
        key: "recipients",
        value: [{ who: spouse, percentage: 60 }, { who: emma, percentage: 20 }, { who: lucas, percentage: 20 }],
        from: [c("b1")("percent"), c("b1")("recipients"), c("b2")("percent"), c("b2")("recipients")],
      },
    ]);
    expect(rest.warnings).toEqual([
      'The remaining estate isn\'t one asset, so "Asset / account / debt" isn\'t saved.',
      'The remaining estate has no condition, so "Condition" isn\'t saved.',
    ]);
    expect(place(BEQUESTS_MAP, [rowOf("b1", { willOf: "Client", gift: "Remaining estate", percent: 50 })]).drafts.map((d) => d.target)).toEqual(["will"]);
  });

  it("a debt is left only to family members or trusts, always, and has no % of it", () => {
    const debt = (cells: Parameters<typeof rowOf>[1]) =>
      place(BEQUESTS_MAP, [rowOf("b1", { willOf: "Client", gift: "Debt (who pays)", asset: "Chase Visa", ...cells })], hendricksBook(kids), accounts).drafts[1];
    expect(debt({ recipients: "Laura" }).blocked).toEqual({ reason: "A debt can be left only to family members or trusts — not to Laura Hendricks.", cell: c("b1")("recipients") });
    const owed = debt({ recipients: "Emma", percent: 50, condition: "If co-client survives" });
    expect(values(owed)).toEqual({ kind: "liability", liabilityId: { ref: "line", target: "liability", lineId: "liab-1/liability" }, recipients: [{ who: emma, percentage: 100 }], condition: "always" });
    expect(owed.warnings).toEqual([
      `"% of it" isn't saved for a debt — the recipients' shares say who pays what.`,
      `A debt provision always applies, so "Condition" isn't saved.`,
    ]);
  });

  it("a will can't give to the person whose will it is", () => {
    const [, mine] = place(BEQUESTS_MAP, [rowOf("b1", { willOf: "Client", gift: "Remaining estate", recipients: "Mark" })]).drafts;
    expect(mine.blocked).toEqual({ reason: "Mark Hendricks can't receive from their own will.", cell: c("b1")("recipients") });
    const [, theirs] = place(BEQUESTS_MAP, [rowOf("b1", { willOf: "Co-client", gift: "Remaining estate", recipients: "Mark" })]).drafts;
    expect(values(theirs)).toEqual({ recipients: [{ who: client, percentage: 100 }] });
  });

  it("blank Will of, Gift or Asset — or an asset or debt that isn't found — is blocked on its cell", () => {
    const one = (cells: Parameters<typeof rowOf>[1]) => place(BEQUESTS_MAP, [rowOf("b1", cells)], hendricksBook(kids), accounts).drafts;
    expect(one({ gift: "Remaining estate", recipients: "Emma" })).toEqual([
      {
        lineId: "b1/will_residuary_recipient", sectionId: "bequests", rowId: "b1", target: "will_residuary_recipient", recordId: null,
        label: "Will provision", fields: [], warnings: [], blocked: { reason: "Pick whose will this is.", cell: c("b1")("willOf") },
      },
    ]);
    expect(one({ willOf: "Client", asset: "Joint Brokerage" })[1].blocked).toEqual({ reason: "Pick what this provision gives.", cell: c("b1")("gift") });
    expect(one({ willOf: "Client", gift: "Specific asset" })[1].blocked).toEqual({ reason: "Name the asset or account it gives.", cell: c("b1")("asset") });
    expect(one({ willOf: "Client", gift: "Debt (who pays)" })[1].blocked).toEqual({ reason: "Name the debt.", cell: c("b1")("asset") });
    expect(one({ willOf: "Client", gift: "Debt (who pays)", asset: "Joint Brokerage" })[1].blocked).toEqual({
      reason: 'No loan named "Joint Brokerage" in this fact finder or on the plan.',
      cell: c("b1")("asset"),
    });
  });

  it("each will numbers its own provisions; one debt can be given only once in a will", () => {
    const rows = [
      rowOf("b1", { willOf: "Client", gift: "Specific asset", asset: "Joint Brokerage", recipients: "Laura" }),
      rowOf("b2", { willOf: "Co-client", gift: "Debt (who pays)", asset: "Chase Visa", recipients: "Emma" }),
      rowOf("b3", { willOf: "Client", gift: "Debt (who pays)", asset: "Chase Visa", recipients: "Lucas" }),
      rowOf("b4", { willOf: "Co-client", gift: "Debt (who pays)", asset: "Chase Visa", recipients: "Lucas" }),
    ];
    const { drafts } = place(BEQUESTS_MAP, rows, hendricksBook(kids), accounts);
    expect(drafts.map((d) => [d.lineId, d.fixed?.sortOrder, d.blocked?.reason])).toEqual([
      ["estate_docs:Client/will", undefined, undefined],
      ["b1/will_bequest", 0, undefined],
      ["b3/will_bequest", 1, undefined],
      ["estate_docs:Co-client/will", undefined, undefined],
      ["b2/will_bequest", 0, undefined],
      ["b4/will_bequest", 1, 'This will already has a provision for "Chase Visa" — one per debt.'],
    ]);
  });

  it("the co-client's will with no co-client is blocked (its provisions hang off it)", () => {
    const [will, rest] = place(BEQUESTS_MAP, [rowOf("b1", { willOf: "Co-client", gift: "Remaining estate", recipients: "Mark" })], bookWith({})).drafts;
    expect(will.blocked).toEqual({ reason: NO_CO_CLIENT_REASON, cell: c("b1")("willOf") });
    expect(rest.dependsOn).toEqual(["estate_docs:Co-client/will"]);
  });

  it("Documents in Place and Will Provisions make one will line per person between them", () => {
    const state = stateWith({
      estate_docs: [docs("Client", { will: true }), docs("Co-client", { will: true })],
      bequests: [rowOf("b1", { willOf: "Client", gift: "Remaining estate", recipients: "Laura" })],
    });
    const { ctx } = contextOf(state, hendricksBook(kids));
    const ids = [...ESTATE_DOCS_MAP.place(state.sections.estate_docs, ctx), ...BEQUESTS_MAP.place(state.sections.bequests, ctx)].map((d) => d.lineId);
    expect(ids).toEqual(["estate_docs:Co-client/will", "estate_docs:Client/will", "b1/will_residuary_recipient"]);
  });
});

describe("GIFTS_MAP", () => {
  const c = at("gifts", "g1");

  it("a filled gift: cash value to a trust in the Trusts section, with what was given and the 709 in its notes", () => {
    const row = rowOf("g1", { year: 2022, from: "Joint (split gift)", recipient: "Hendricks ILIT", given: "Cash.", amount: 36000, form709Filed: "Yes" });
    const trusts = [rowOf("t1", { trustName: "Hendricks ILIT", trustType: "ILIT" })];
    expect(place(GIFTS_MAP, [row], hendricksBook(kids), { trusts }).drafts).toEqual([
      {
        lineId: "g1/gift",
        sectionId: "gifts",
        rowId: "g1",
        target: "gift",
        recordId: null,
        label: "2022 gift to Hendricks ILIT",
        fields: [
          { key: "year", value: 2022, from: [c("year")] },
          { key: "grantor", value: "joint", from: [c("from")] },
          { key: "recipient", value: { ref: "line", target: "entity", lineId: "t1/entity" }, from: [c("recipient")] },
          { key: "amount", value: 36000, from: [c("amount")] },
          { key: "notes", value: "Given: Cash. Form 709 filed: Yes.", from: [c("given"), c("form709Filed")] },
        ],
        warnings: [],
        dependsOn: ["t1/entity"],
      },
    ]);
  });

  it("a gift goes to one family member, charity or irrevocable trust — never the client, the co-client or a revocable trust", () => {
    const to = (recipient: string, other: Record<string, FFRow[]> = {}) => place(GIFTS_MAP, [rowOf("g1", { year: 2020, recipient })], hendricksBook(kids), other).drafts[0];
    expect(values(to("Emma")).recipient).toEqual(emma);
    expect(to("Laura").blocked).toEqual({ reason: `"Laura" is the co-client, who can't be named here.`, cell: c("recipient") });
    const revocable = { trusts: [rowOf("t1", { trustName: "Hendricks Family Trust", trustType: "Revocable living trust" })] };
    expect(to("Hendricks Family Trust", revocable).blocked?.reason).toBe(`"Hendricks Family Trust" is a revocable living trust, which can't be named here.`);
    expect(to("Emma and Lucas").blocked).toEqual({ reason: "A gift has one recipient — list each gift on its own row.", cell: c("recipient") });
    expect(to("Olivia").blocked?.reason).toBe('No one named "Olivia" in this fact finder or on the plan.');
    const andTrust = { trusts: [rowOf("t1", { trustName: "Mark and Laura Hendricks Trust", trustType: "Irrevocable" })] };
    expect(values(to("Mark and Laura Hendricks Trust", andTrust)).recipient).toEqual({ ref: "line", target: "entity", lineId: "t1/entity" });
  });

  it("notes from one cell; blank cells make no field", () => {
    expect(place(GIFTS_MAP, [rowOf("g1", { year: 2020, form709Filed: "No" })]).drafts[0].fields).toEqual([
      { key: "year", value: 2020, from: [c("year")] },
      { key: "notes", value: "Form 709 filed: No.", from: [c("form709Filed")] },
    ]);
    const [blank] = place(GIFTS_MAP, [rowOf("g1", { amount: 18000, given: null, recipient: "" })]).drafts;
    expect(blank.label).toBe("Gift");
    expect(values(blank)).toEqual({ amount: 18000 });
  });

  it("a gift from the co-client, or split, needs a co-client", () => {
    for (const from of ["Co-client", "Joint (split gift)"]) {
      expect(place(GIFTS_MAP, [rowOf("g1", { year: 2020, from })], bookWith({})).drafts[0].blocked).toEqual({ reason: NO_CO_CLIENT_REASON, cell: c("from") });
    }
    expect(place(GIFTS_MAP, [rowOf("g1", { year: 2020, from: "Client" })], bookWith({})).drafts[0].blocked).toBeUndefined();
  });

  it("a gift on record by its link; a row linked to a record not in the book never updates it", () => {
    const book = hendricksBook({ ...kids, gift: [recordOf("gift-1", "2022 gift", { year: 2022 })] });
    expect(place(GIFTS_MAP, [rowOf("g1", { year: 2022, amount: 36000 }, { link: linkedTo("gift-1") })], book).drafts[0].recordId).toBe("gift-1");
    expect(place(GIFTS_MAP, [rowOf("g1", { year: 2022 }, { link: linkedTo("gift-of-another-client") })], book).drafts[0].recordId).toBeNull();
  });
});
