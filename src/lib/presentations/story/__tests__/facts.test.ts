import { describe, it, expect } from "vitest";
import {
  moneyFact,
  pctFact,
  yearFact,
  quotedFact,
  factDisplaySet,
  factLabelSet,
  hasAccountingNegative,
} from "../facts";

describe("story facts", () => {
  it("formats money compactly and never shows cents", () => {
    expect(moneyFact("a", "A", 1_234_567).display).toBe("$1.2M");
    expect(moneyFact("b", "B", 45_600).display).toBe("$46K");
    expect(moneyFact("c", "C", 812).display).toBe("$812");
  });

  it("formats a rate as a percentage with at most one decimal", () => {
    expect(pctFact("d", "D", 0.91).display).toBe("91%");
    expect(pctFact("e", "E", 0.735).display).toBe("73.5%");
  });

  it("formats a year as four bare digits", () => {
    expect(yearFact("f", "F", 2041).display).toBe("2041");
  });

  it("keeps the raw value alongside the display string", () => {
    const f = moneyFact("g", "Liquid assets", 2_100_000);
    expect(f).toEqual({ id: "g", label: "Liquid assets", display: "$2.1M", raw: 2_100_000 });
  });

  /**
   * A quoted figure keeps the spelling it arrived in and carries no number.
   * `compactCurrency(1500)` is "$1.5k" where `fmtUsdCompact(1500)` is "$2K", so
   * parsing the token back to 1500 to fill `raw` would let a later formatter
   * print a different number than the one the client was shown.
   */
  it("quotes a foreign figure verbatim and refuses to guess the number behind it", () => {
    expect(
      quotedFact("quoted.$1.5k", 'Boost the 401(k) — from "Annual amount: $1.5k → $2k"', "$1.5k", [
        "whatWeRecommend",
      ]),
    ).toEqual({
      id: "quoted.$1.5k",
      label: 'Boost the 401(k) — from "Annual amount: $1.5k → $2k"',
      display: "$1.5k",
      raw: null,
      chapters: ["whatWeRecommend"],
    });
  });

  /**
   * The parens are not part of the token — `extractFigures("($50k)")` returns
   * "$50k" — so a figure lifted out of an accounting negative is
   * indistinguishable from an ordinary positive, and the check has to see the
   * text it came from.
   */
  it.each([
    ["Annual amount: ($50k) → ($20k)", true],
    ["( $50k )", true],
    ["Annual amount: $50k → $20k", false],
    ["New growth 6.2%/yr (custom mix)", false], // parens that are not a negative
    ["2030 (Retirement)", false],
  ])("reads %j as an accounting negative: %s", (text, expected) => {
    expect(hasAccountingNegative(text)).toBe(expected);
  });

  it("collects every display string into a lookup set", () => {
    const set = factDisplaySet([moneyFact("a", "A", 1_234_567), pctFact("b", "B", 0.91)]);
    expect(set.has("$1.2M")).toBe(true);
    expect(set.has("91%")).toBe(true);
    expect(set.has("$9.9M")).toBe(false);
  });
});

describe("factLabelSet", () => {
  it("collects every label, lowercased, so a gate can match case-insensitively", () => {
    const set = factLabelSet([
      moneyFact("a", "Left at the end, current plan", 4_500_000),
      pctFact("b", "Confidence, current plan", 0.737),
    ]);
    expect(set.has("left at the end, current plan")).toBe(true);
    expect(set.has("confidence, current plan")).toBe(true);
    expect(set.has("net worth today")).toBe(false);
  });
});
