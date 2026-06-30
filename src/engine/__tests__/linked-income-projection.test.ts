import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, sampleAccounts } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, AssetTransaction, Income } from "../types";

/**
 * Integration smoke for Task 5: `expandLinkedIncomes` is wired in at the top of
 * `runProjection`, so a `type: "other"` income linked to a real-estate property
 * must vanish from the projection in the year that property is fully sold. The
 * per-era / fractional-ownership math itself is unit-tested at the resolver
 * level (Task 4 — linked-income.test.ts); this test only proves the wiring.
 */
describe("linked income through runProjection", () => {
  it("stops a linked rental income in the year its property is fully sold", () => {
    const rental: Account = {
      id: "re-1",
      name: "Rental Property",
      category: "real_estate",
      subType: "rental",
      titlingType: "jtwros", // ignored for solo-owned accounts; satisfies the type
      value: 600000,
      basis: 400000,
      growthRate: 0.03,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };

    const rentalIncome: Income = {
      id: "inc-rental",
      type: "other",
      name: "Rental Income",
      annualAmount: 60000,
      startYear: 2026,
      endYear: 2035,
      growthRate: 0,
      owner: "client",
      linkedPropertyId: "re-1",
    };

    const sale: AssetTransaction = {
      id: "sale-re-1",
      name: "Sell Rental",
      type: "sell",
      year: 2030,
      accountId: "re-1",
      fractionSold: null, // full sale
      proceedsAccountId: "acct-savings", // route proceeds to the sample cash account
    };

    const data = buildClientData({
      // Keep the sample real-estate home + cash account so the sale + proceeds
      // routing have valid targets; append the linked rental + its income.
      accounts: [...sampleAccounts, rental],
      incomes: [rentalIncome],
      assetTransactions: [sale],
    });

    const years = runProjection(data);
    const yearOf = (y: number) => years.find((yr) => yr.year === y)!;

    // Sum only the linked rental's contribution: `expandLinkedIncomes` rewrites
    // it into owner-era slices whose ids are prefixed by the original id, and
    // `computeIncome` keys `income.bySource` by income id. Reading the prefix
    // isolates the rental from the property-sale capital gain, which lands in
    // the aggregate `income.other` in the sale year via a separate engine path.
    const rentalIncomeIn = (y: number) =>
      Object.entries(yearOf(y).income.bySource)
        .filter(([id]) => id.startsWith("inc-rental"))
        .reduce((s, [, amt]) => s + amt, 0);

    // The linked income contributes while the property is owned.
    expect(rentalIncomeIn(2026)).toBeGreaterThan(0);
    expect(rentalIncomeIn(2029)).toBeGreaterThan(0);

    // From the full-sale year onward the surviving fraction is 0 → no slice,
    // so the linked rental contributes nothing.
    expect(rentalIncomeIn(2030)).toBe(0);
    expect(rentalIncomeIn(2031)).toBe(0);
  });

  it("does not throw and produces years for a plan with linked-income data", () => {
    const data = buildClientData({
      accounts: [
        ...sampleAccounts,
        {
          id: "re-2",
          name: "Second Rental",
          category: "real_estate",
          subType: "rental",
          titlingType: "jtwros", // ignored for solo-owned accounts; satisfies the type
          value: 300000,
          basis: 250000,
          growthRate: 0.03,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
        },
      ],
      incomes: [
        {
          id: "inc-rental-2",
          type: "other",
          name: "Rental Income 2",
          annualAmount: 24000,
          startYear: 2026,
          endYear: 2055,
          growthRate: 0.02,
          owner: "client",
          linkedPropertyId: "re-2",
        },
      ],
    });

    const years = runProjection(data);
    expect(years.length).toBeGreaterThan(0);
  });
});
