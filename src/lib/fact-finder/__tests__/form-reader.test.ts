import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isOurFactFinder,
  readFormFields,
  readingsFromFormFields,
  type FormField,
} from "../readers/form-reader";

const FIXTURES = path.join(__dirname, "../__fixtures__");
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name));
const field = (name: string, value: string, type = "text", page: number | null = 1): FormField => ({ name, type, value, page });

describe("readingsFromFormFields", () => {
  it("maps list, fixed-row and transposed fields through pdfIndex", () => {
    const out = readingsFromFormFields("f1", [
      field("retirement_r2_c1", "Laura IRA"),
      field("retirement_r2_c2", "$120,000"),
      field("retirement_r2_c13", "1941"),
      field("people_r2_c1", "Laura"),
      field("life_r6_c1", "$1,000,000", "text", 7),
      field("life_r1_c1", "Term 20", "text", 7),
    ]);
    const retirement = out.readings.find((r) => r.sectionId === "retirement")!;
    expect(retirement.cells.accountName.value).toBe("Laura IRA");
    expect(retirement.cells.currentValue).toEqual({ value: 120000, confidence: 1, source: { fileId: "f1", page: 1 } });
    expect(retirement.cells.originalOwnerBirthYear.value).toBe(1941);
    const people = out.readings.find((r) => r.sectionId === "people")!;
    expect(people.fixedRow).toBe("Co-client");
    const life = out.readings.find((r) => r.sectionId === "life")!;
    expect(life.cells.deathBenefit.value).toBe(1_000_000);
    expect(life.cells.policyName.source.page).toBe(7);
  });

  it("treats the blank choice and unchecked boxes as empty", () => {
    const out = readingsFromFormFields("f1", [
      field("family_r1_c3", " ", "combobox"),
      field("family_r1_c6", "Off", "checkbox"),
      field("family_r2_c1", "Lucas"),
      field("family_r2_c6", "Yes", "checkbox"),
    ]);
    expect(out.readings).toHaveLength(1);
    expect(out.readings[0].cells.domesticPartner.value).toBe(true);
  });

  it("keeps a choice that's no longer an option as text with 'check this'", () => {
    const out = readingsFromFormFields("f1", [field("trusts_r1_c1", "Family Trust"), field("trusts_r1_c3", "Joint", "combobox")]);
    expect(out.readings[0].cells.grantor).toEqual({
      value: "Joint",
      confidence: 0.3,
      source: { fileId: "f1", page: 1 },
      issue: "notAnOption",
    });
  });

  it("reads notes boxes into their notes row", () => {
    const out = readingsFromFormFields("f1", [field("final_notes", "Buying a cabin in 2030", "text", 10)]);
    expect(out.readings).toEqual([
      {
        sectionId: "final_notes",
        fixedRow: "Notes",
        fileId: "f1",
        cells: { notes: { value: "Buying a cabin in 2030", confidence: 1, source: { fileId: "f1", page: 10 } } },
      },
    ]);
  });

  it("skips itemized living-expense rows that only carry the printed item name", () => {
    const out = readingsFromFormFields("f1", [
      field("living_items1_r1_c1", "Groceries"),
      field("living_items1_r2_c1", "Utilities"),
      field("living_items1_r2_c2", "$450"),
      field("living_items3_r1_c1", "Gifts & giving"),
    ]);
    expect(out.readings.map((r) => r.cells.item.value)).toEqual(["Utilities"]);
  });

  it("turns every holdings row into an unassigned holding with its account hint", () => {
    const out = readingsFromFormFields("f1", [
      field("holdings_r1_c1", "7731", "text", 10),
      field("holdings_r1_c2", "VTI", "text", 10),
      field("holdings_r1_c4", "820", "text", 10),
      field("holdings_r1_c6", "$205,082", "text", 10),
      field("holdings_r2_c1", " ", "text", 10),
    ]);
    expect(out.unassignedHoldings).toEqual([
      {
        fileId: "f1",
        accountHint: "7731",
        holding: { ticker: "VTI", shares: 820, marketValue: 205082 },
        source: { fileId: "f1", page: 10 },
      },
    ]);
  });

  it("warns about an unreadable holdings number instead of dropping it silently", () => {
    const out = readingsFromFormFields("f1", [
      field("holdings_r3_c1", "7731", "text", 10),
      field("holdings_r3_c2", "VTI", "text", 10),
      field("holdings_r3_c4", "820 sh", "text", 10),
      field("holdings_r4_c4", "lots", "text", 10),
    ]);
    expect(out.unassignedHoldings).toEqual([
      { fileId: "f1", accountHint: "7731", holding: { ticker: "VTI" }, source: { fileId: "f1", page: 10 } },
    ]);
    expect(out.warnings).toEqual([
      'Holdings row 3: couldn\'t read Shares "820 sh".',
      'Holdings row 4: couldn\'t read Shares "lots".',
    ]);
  });

  it("ignores fields it doesn't know", () => {
    expect(readingsFromFormFields("f1", [field("signature", "M.H."), field("zzz_r1_c1", "x")]).readings).toEqual([]);
  });
});

describe("Reader 1 on the committed PDFs", () => {
  it("recognizes the blank PDF and reads nothing from it", async () => {
    const form = await readFormFields(fixture("fact-finder-blank.pdf"));
    expect(form && isOurFactFinder(form)).toBe(true);
    const out = readingsFromFormFields("blank", form!.fields);
    expect(out.readings).toEqual([]);
    expect(out.unassignedHoldings).toEqual([]);
  });

  it("reads the fictional Hendricks fact finder", async () => {
    const form = await readFormFields(fixture("hendricks-fact-finder.pdf"));
    expect(form && isOurFactFinder(form)).toBe(true);
    const { readings, unassignedHoldings } = readingsFromFormFields("hk", form!.fields);
    const find = (sectionId: string, pick: (r: (typeof readings)[number]) => boolean = () => true) =>
      readings.find((r) => r.sectionId === sectionId && pick(r))!;

    expect(find("people", (r) => r.fixedRow === "Client").cells.dateOfBirth.value).toBe("1968-04-12");
    expect(find("people", (r) => r.fixedRow === "Client").cells.dateOfBirth.source.page).toBe(1);
    expect(find("household").cells.filingStatus.value).toBe("Married filing jointly");
    expect(find("cash").cells.interestRate.value).toBe(0.5);
    const inherited = find("retirement", (r) => r.cells.last4?.value === "9054");
    expect(inherited.cells.originalOwnerBirthYear.value).toBe(1941);
    expect(inherited.cells.originalOwnerDeathYear.value).toBe(2019);
    expect(find("liab").cells.balanceAsOf.value).toBe("2026-09");
    expect(find("expenses").cells.isGoal.value).toBe(true);
    expect(find("estate_docs", (r) => r.fixedRow === "Co-client").cells.will.value).toBe(true);
    expect(find("life").cells.policyNumber.value).toBe("NM-55820013");
    expect(find("insurance_notes").cells.notes.value).toBe("Mark has group life at 2x salary through Acme.");
    expect(readings.filter((r) => r.sectionId === "living_items").map((r) => r.cells.item.value)).toEqual([
      "Groceries",
      "Utilities",
    ]);
    expect(unassignedHoldings.map((h) => [h.accountHint, h.holding.ticker])).toEqual([
      ["7731", "VTI"],
      ["Joint Brokerage", "BND"],
      ["x9999", "AAPL"],
    ]);
    expect(unassignedHoldings[0].source.page).toBe(10);
    expect(readings.every((r) => Object.values(r.cells).every((c) => c.issue === undefined))).toBe(true);
  });

  it("keeps an older copy's 'Joint' trust grantor as text to check (Review Focus 1)", async () => {
    const form = await readFormFields(fixture("legacy-joint-grantor.pdf"));
    const { readings } = readingsFromFormFields("legacy", form!.fields);
    const trust = readings.find((r) => r.sectionId === "trusts")!;
    expect(trust.cells.trustName.value).toBe("Hendricks Family Trust");
    expect(trust.cells.grantor).toMatchObject({ value: "Joint", confidence: 0.3, issue: "notAnOption" });
  });

  it("returns null for a file that isn't a PDF, and says a statement isn't ours", async () => {
    expect(await readFormFields(Buffer.from("not a pdf"))).toBeNull();
    expect(isOurFactFinder({ title: "Statement", author: "Schwab", fields: [] })).toBe(false);
  });
});
