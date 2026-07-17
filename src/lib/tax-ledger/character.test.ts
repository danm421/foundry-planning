// src/lib/tax-ledger/character.test.ts
import { describe, expect, it } from "vitest";
import { rawTypeToCharacter, isTaxableCharacter, CHARACTER_LABEL } from "./character";

describe("rawTypeToCharacter", () => {
  it("maps every engine bySource type", () => {
    expect(rawTypeToCharacter("earned_income")).toBe("earned");
    expect(rawTypeToCharacter("ordinary_income")).toBe("ordinary");
    expect(rawTypeToCharacter("dividends")).toBe("qualified_dividends");
    expect(rawTypeToCharacter("capital_gains")).toBe("long_term_gain");
    expect(rawTypeToCharacter("stcg")).toBe("short_term_gain");
    expect(rawTypeToCharacter("qbi")).toBe("ordinary");
    expect(rawTypeToCharacter("tax_exempt")).toBe("tax_exempt");
    expect(rawTypeToCharacter("tax_free")).toBe("non_taxable");
  });
  it("falls back to ordinary for unknown", () => {
    expect(rawTypeToCharacter("mystery")).toBe("ordinary");
  });
});

describe("isTaxableCharacter", () => {
  it("excludes deduction / tax_exempt / non_taxable", () => {
    expect(isTaxableCharacter("ordinary")).toBe(true);
    expect(isTaxableCharacter("deduction")).toBe(false);
    expect(isTaxableCharacter("tax_exempt")).toBe(false);
    expect(isTaxableCharacter("non_taxable")).toBe(false);
  });
});

describe("CHARACTER_LABEL", () => {
  it("has a label for every character", () => {
    expect(CHARACTER_LABEL.long_term_gain).toBe("Long-Term Gain");
  });
});
