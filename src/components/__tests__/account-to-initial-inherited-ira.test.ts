// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { accountToInitial, type AccountRow } from "../balance-sheet-view";

describe("accountToInitial — inherited IRA", () => {
  it("hands the three fields to the edit form", () => {
    const row = {
      id: "acct-1", name: "Inherited IRA", category: "retirement", subType: "traditional_ira",
      owner: "client", value: "400000", basis: "0", growthRate: null,
      inheritedDeathYear: 2022, inheritedOwnerBirthYear: 1945, inheritedHeirDisabled: false,
    } as AccountRow;
    expect(accountToInitial(row)).toMatchObject({
      inheritedDeathYear: 2022, inheritedOwnerBirthYear: 1945, inheritedHeirDisabled: false,
    });
  });
});
