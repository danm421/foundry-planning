// src/lib/fact-finder/__tests__/section-prompt.test.ts
import { describe, expect, it } from "vitest";
import { FACT_FINDER_SECTIONS, findSection } from "../schema";
import { buildSectionPrompt, columnLine, sectionVocabulary } from "../readers/section-prompt";

describe("buildSectionPrompt", () => {
  it("lists every column with its kind rule and exact options", () => {
    const { prompt } = buildSectionPrompt(findSection("retirement")!);
    expect(prompt).toContain('You read one section of a client\'s financial fact finder: "Retirement Accounts".');
    expect(prompt).toContain("- currentValue — Current value | money: a plain number, no $ or commas");
    expect(prompt).toContain('- accountType — Account type | one of the listed options | one of exactly: "Traditional IRA", "Roth IRA"');
    expect(prompt).toContain("- originalOwnerBirthYear — Original owner's birth year | a 4-digit year");
    expect(prompt).toMatch(/Never guess, compute or fill in a value that isn't there/);
  });

  it("asks fixed-row sections to say whose row it is", () => {
    expect(buildSectionPrompt(findSection("ss")!).prompt).toContain('give each row a "_row" key set to exactly one of: "Client", "Co-client"');
  });

  it("is stable, and changes when a column changes", () => {
    const a = buildSectionPrompt(findSection("cash")!);
    expect(buildSectionPrompt(findSection("cash")!).hash).toBe(a.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{12}$/);
    expect(buildSectionPrompt({ ...findSection("cash")!, label: "Cash" }).hash).not.toBe(a.hash);
  });

  it("states percents are whole numbers", () => {
    expect(columnLine(findSection("cash")!.columns.find((c) => c.id === "interestRate")!)).toContain(
      "a percent as a whole number: 6.5 means 6.5% (never 0.065)",
    );
  });
});

describe("sectionVocabulary", () => {
  it("offers every section to the region classifier, with its columns as hints", () => {
    const vocab = sectionVocabulary();
    expect(vocab.map((v) => v.id)).toEqual(FACT_FINDER_SECTIONS.map((s) => s.id));
    const liab = vocab.find((v) => v.id === "liab")!;
    expect(liab.documentHints?.[0]).toMatch(/Mortgages, HELOCs/);
    expect(liab.documentHints?.[1]).toMatch(/^columns: Loan name, Type, Owner, Balance/);
  });
});
