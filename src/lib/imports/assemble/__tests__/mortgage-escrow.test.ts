import { describe, expect, it } from "vitest";
import { splitMortgageEscrow } from "../mortgage-escrow";
import type { ExtractedAccount, ExtractedLiability } from "@/lib/extraction/types";

function mortgage(over: Partial<ExtractedLiability> = {}): ExtractedLiability {
  return {
    name: "Mortgage",
    balance: 412_000,
    interestRate: 0.0625,
    monthlyPayment: 2_538,   // P&I
    totalPayment: 3_163,     // PITI -> 625/mo escrow -> 7,500/yr
    propertyAddress: "5304 Hudson Avenue",
    ...over,
  };
}

function property(over: Partial<ExtractedAccount> = {}): ExtractedAccount {
  return { name: "Hudson Avenue Home", category: "real_estate", value: 850_000, ...over };
}

describe("splitMortgageEscrow", () => {
  it("annualizes the escrow onto an existing property matched by name tokens", () => {
    const { accounts } = splitMortgageEscrow({
      accounts: [property()],
      liabilities: [mortgage()],
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0].annualPropertyTax).toBe(7_500);
    expect(accounts[0].propertyAddress).toBe("5304 Hudson Avenue");
    expect(accounts[0].value).toBe(850_000);
  });

  it("prefers an exact address match over name tokens", () => {
    const { accounts } = splitMortgageEscrow({
      accounts: [
        property({ name: "Hudson Avenue Home" }),
        property({ name: "Beach House", propertyAddress: "5304 Hudson Avenue" }),
      ],
      liabilities: [mortgage()],
    });
    expect(accounts[0].annualPropertyTax).toBeUndefined();
    expect(accounts[1].annualPropertyTax).toBe(7_500);
  });

  it("synthesizes a property with NO value when the plan has none", () => {
    const { accounts, warnings } = splitMortgageEscrow({
      accounts: [],
      liabilities: [mortgage()],
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0].name).toBe("5304 Hudson Avenue");
    expect(accounts[0].category).toBe("real_estate");
    expect(accounts[0].subType).toBe("primary_residence");
    expect(accounts[0].propertyAddress).toBe("5304 Hudson Avenue");
    expect(accounts[0].annualPropertyTax).toBe(7_500);
    // A mortgage statement never states what the home is worth.
    expect(accounts[0].value).toBeUndefined();
    expect(warnings.join(" ")).toMatch(/what it is worth/i);
  });

  it("writes no property tax when the statement prints no total payment", () => {
    const { accounts } = splitMortgageEscrow({
      accounts: [],
      liabilities: [mortgage({ totalPayment: undefined })],
    });
    expect(accounts[0].annualPropertyTax).toBeUndefined();
  });

  it("writes no property tax when the total payment equals P&I", () => {
    const { accounts } = splitMortgageEscrow({
      accounts: [],
      liabilities: [mortgage({ totalPayment: 2_538 })],
    });
    expect(accounts[0].annualPropertyTax).toBeUndefined();
  });

  it("warns and writes nothing when the total payment is BELOW P&I", () => {
    const { accounts, warnings } = splitMortgageEscrow({
      accounts: [],
      liabilities: [mortgage({ totalPayment: 1_000 })],
    });
    expect(accounts[0].annualPropertyTax).toBeUndefined();
    expect(warnings.join(" ")).toMatch(/less than its principal and interest/i);
  });

  it("ignores a liability with no property address", () => {
    const { accounts } = splitMortgageEscrow({
      accounts: [],
      liabilities: [mortgage({ propertyAddress: undefined, name: "Auto Loan" })],
    });
    expect(accounts).toHaveLength(0);
  });

  it("never mutates the caller's accounts array", () => {
    const input = [property()];
    const snapshot = JSON.stringify(input);
    splitMortgageEscrow({ accounts: input, liabilities: [mortgage()] });
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("does not overwrite a property tax the document already stated", () => {
    const { accounts } = splitMortgageEscrow({
      accounts: [property({ annualPropertyTax: 9_100 })],
      liabilities: [mortgage()],
    });
    expect(accounts[0].annualPropertyTax).toBe(9_100);
  });

  it("writes no property tax when the escrow rounds away to zero", () => {
    const { accounts } = splitMortgageEscrow({
      accounts: [],
      liabilities: [mortgage({ totalPayment: 2_538.01 })],
    });
    // A derived 0 would read as "this house has no property tax".
    expect(accounts[0].annualPropertyTax).toBeUndefined();
  });

  it("gives two mortgages on two properties one property each", () => {
    const { accounts } = splitMortgageEscrow({
      accounts: [],
      liabilities: [
        mortgage(),
        mortgage({ propertyAddress: "12 Beach Road", totalPayment: 2_538 + 100 }),
      ],
    });
    expect(accounts).toHaveLength(2);
    expect(accounts.map((a) => a.name)).toEqual(["5304 Hudson Avenue", "12 Beach Road"]);
    expect(accounts[1].annualPropertyTax).toBe(1_200);
  });
});
