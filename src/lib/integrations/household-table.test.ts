// src/lib/integrations/household-table.test.ts
import { describe, it, expect } from "vitest";
import { sortHouseholdRows, type HouseholdTableRow } from "./household-table";

function row(over: Partial<HouseholdTableRow> & { id: string }): HouseholdTableRow {
  return { name: null, link: null, lockedBy: null, accounts: null, ...over };
}

describe("sortHouseholdRows", () => {
  it("sorts linked households first, then A–Z, unnamed last", () => {
    const sorted = sortHouseholdRows([
      row({ id: "1", name: "Zed" }),
      row({ id: "2", name: "Adams" }),
      row({ id: "3", name: "Moss", link: { linkId: "L1", clientId: "c1" } }),
      row({ id: "9", name: null }),
    ]);
    expect(sorted.map((r) => r.name)).toEqual(["Moss", "Adams", "Zed", null]);
  });

  it("ignores case and accents, and orders unnamed households by id", () => {
    const sorted = sortHouseholdRows([
      row({ id: "10" }),
      row({ id: "2" }),
      row({ id: "a", name: "émile" }),
      row({ id: "b", name: "Doe" }),
      row({ id: "c", name: "adams" }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["c", "b", "a", "2", "10"]);
  });

  it("does not reorder the array it was given", () => {
    const input = [row({ id: "1", name: "Zed" }), row({ id: "2", name: "Adams" })];
    sortHouseholdRows(input);
    expect(input.map((r) => r.id)).toEqual(["1", "2"]);
  });
});
