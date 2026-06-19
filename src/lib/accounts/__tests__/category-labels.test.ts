import { describe, it, expect } from "vitest";
import { formatAccountCategory } from "../category-labels";

describe("formatAccountCategory", () => {
  it("maps known enum categories to curated labels", () => {
    expect(formatAccountCategory("life_insurance")).toBe("Life Insurance");
    expect(formatAccountCategory("retirement")).toBe("Retirement");
    expect(formatAccountCategory("notes_receivable")).toBe("Notes Receivable");
    expect(formatAccountCategory("stock_options")).toBe("Stock Options");
  });

  it("title-cases an unknown underscore-delimited value as a fallback", () => {
    expect(formatAccountCategory("foo_bar")).toBe("Foo Bar");
  });

  it("returns a single unknown word title-cased", () => {
    expect(formatAccountCategory("crypto")).toBe("Crypto");
  });
});
