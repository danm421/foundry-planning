import { describe, it, expect } from "vitest";
import { matchMortgageToProperty, type PropertyRef } from "@/lib/imports/commit/mortgage-link";

const properties: PropertyRef[] = [
  { id: "p-austin-home", name: "Home - Austin" },
  { id: "p-austin-condo", name: "Austin Condo" },
  { id: "p-sa", name: "Home - San Antonio" },
];

describe("matchMortgageToProperty", () => {
  it("links a mortgage to the best-overlap property", () => {
    // {austin, home} -> Home-Austin scores 2, Austin Condo 1, San Antonio 1
    expect(matchMortgageToProperty("Mortgage - Austin Home", properties)).toBe("p-austin-home");
  });

  it("returns null when there is no overlap", () => {
    expect(matchMortgageToProperty("Boat Loan", properties)).toBeNull();
  });

  it("returns null on a tie (ambiguous)", () => {
    const ambiguous: PropertyRef[] = [
      { id: "p1", name: "Lake House" },
      { id: "p2", name: "Lake Cabin" },
    ];
    // {lake} matches both equally -> unlinked
    expect(matchMortgageToProperty("Lake Mortgage", ambiguous)).toBeNull();
  });

  it("returns null when there are no properties", () => {
    expect(matchMortgageToProperty("Mortgage - Austin Home", [])).toBeNull();
  });
});
