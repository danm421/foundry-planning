import { describe, expect, it } from "vitest";
import {
  FACT_FINDER_SECTIONS,
  NOTES_ROW_LABEL,
  PAGE_ORDER,
  PDF_HOLDINGS_TABLE,
  findColumn,
  findSection,
  fixedLabelsOf,
  pdfKeysOf,
  sectionsLinkingTo,
  sectionsOnPage,
} from "../schema";

describe("fact finder schema", () => {
  it("gives every section a unique id on a known page", () => {
    const ids = FACT_FINDER_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const pages = new Set(PAGE_ORDER.map((p) => p.id));
    for (const s of FACT_FINDER_SECTIONS) expect(pages.has(s.page)).toBe(true);
  });

  it("gives every column a unique id within its section", () => {
    for (const s of FACT_FINDER_SECTIONS) {
      const ids = s.columns.map((c) => c.id);
      expect(new Set(ids).size, s.id).toBe(ids.length);
    }
  });

  it("gives options to choice columns, and only to them", () => {
    for (const s of FACT_FINDER_SECTIONS) {
      for (const c of s.columns) {
        if (c.kind === "choice") expect(c.options?.length, `${s.id}.${c.id}`).toBeGreaterThan(0);
        else expect(c.options, `${s.id}.${c.id}`).toBeUndefined();
      }
    }
  });

  it("numbers each section's PDF columns 1..n with no gaps or repeats", () => {
    for (const s of FACT_FINDER_SECTIONS) {
      const indexes = s.columns.flatMap((c) => (c.pdfIndex === undefined ? [] : [c.pdfIndex]));
      if (s.layout === "notes") {
        expect(indexes, s.id).toEqual([]);
        continue;
      }
      expect([...indexes].sort((a, b) => a - b), s.id).toEqual(indexes.map((_, i) => i + 1));
    }
  });

  it("declares the shape each layout needs", () => {
    for (const s of FACT_FINDER_SECTIONS) {
      if (s.layout === "fixedRows") expect(s.fixedRows?.length, s.id).toBeGreaterThan(0);
      if (s.layout === "transposed") expect(s.entries, s.id).toBeGreaterThan(0);
      if (s.layout === "list") expect(s.pdfRows, s.id).toBeGreaterThan(0);
    }
  });

  it("puts holdings only on account sections", () => {
    for (const s of FACT_FINDER_SECTIONS.filter((x) => x.holdings)) expect(s.links, s.id).toBe("account");
  });

  it("gives a screen-only 'which trust / entity' column to every owner list that offers one", () => {
    for (const s of FACT_FINDER_SECTIONS) {
      const owner = s.columns.find((c) => c.id === "owner");
      const needsName = owner?.options?.some((o) => o === "Trust / entity" || o === "Other");
      if (s.id === "edu") continue; // a 529 owner is not saved (spec § 8)
      if (needsName) {
        const entity = findColumn(s.id, "ownerEntity");
        expect(entity, s.id).toBeDefined();
        expect(entity?.pdfIndex, s.id).toBeUndefined();
      }
    }
  });

  it("links notes receivable to their own record kind", () => {
    expect(findSection("notes_rec")?.links).toBe("noteReceivable");
  });

  it("appends the inherited-IRA years to Retirement as PDF columns 13 and 14", () => {
    expect(findColumn("retirement", "originalOwnerBirthYear")?.pdfIndex).toBe(13);
    expect(findColumn("retirement", "originalOwnerDeathYear")?.pdfIndex).toBe(14);
  });

  it("describes fixed and notes rows, and PDF keys", () => {
    expect(fixedLabelsOf(findSection("people")!)).toEqual(["Client", "Co-client"]);
    expect(fixedLabelsOf(findSection("final_notes")!)).toEqual([NOTES_ROW_LABEL]);
    expect(fixedLabelsOf(findSection("cash")!)).toEqual([]);
    expect(pdfKeysOf(findSection("living_items")!)).toEqual(["living_items1", "living_items2", "living_items3"]);
    expect(pdfKeysOf(findSection("cash")!)).toEqual(["cash"]);
  });

  it("finds sections by page and by linked record kind", () => {
    expect(sectionsOnPage("estate").map((s) => s.id)).toEqual([
      "estate_docs", "trusts", "bequests", "gifts", "final_notes",
    ]);
    expect(sectionsLinkingTo("account").map((s) => s.id)).toEqual([
      "cash", "taxable", "retirement", "annuity", "edu", "realestate", "business",
    ]);
    expect(PDF_HOLDINGS_TABLE.columns.map((c) => c.pdfIndex)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
