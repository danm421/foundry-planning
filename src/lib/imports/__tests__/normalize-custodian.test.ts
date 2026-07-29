import { describe, expect, it } from "vitest";

import { custodianMatches, normalizeCustodian } from "../normalize-custodian";

describe("normalizeCustodian", () => {
  it("lowercases and collapses punctuation", () => {
    expect(normalizeCustodian("Charles Schwab & Co.")).toBe("charles schwab");
  });

  it("strips trailing legal suffixes", () => {
    expect(normalizeCustodian("Fidelity Brokerage Services LLC")).toBe(
      "fidelity brokerage services",
    );
    expect(normalizeCustodian("Pershing Advisor Solutions, Inc.")).toBe(
      "pershing advisor solutions",
    );
    expect(normalizeCustodian("Wells Fargo Bank, N.A.")).toBe("wells fargo bank");
  });

  it("does NOT strip a leading or interior 'bank' token", () => {
    expect(normalizeCustodian("Bank of America")).toBe("bank of america");
  });

  it("returns null for empty or missing input", () => {
    expect(normalizeCustodian(null)).toBeNull();
    expect(normalizeCustodian(undefined)).toBeNull();
    expect(normalizeCustodian("   ")).toBeNull();
    expect(normalizeCustodian("LLC")).toBeNull();
  });
});

describe("custodianMatches", () => {
  it("matches identical normalized names", () => {
    expect(custodianMatches("fidelity", "fidelity")).toBe(true);
  });

  it("matches on a word-boundary prefix in either direction", () => {
    expect(custodianMatches("fidelity", "fidelity investments")).toBe(true);
    expect(custodianMatches("fidelity brokerage services", "fidelity")).toBe(true);
  });

  it("does not match on a partial-word prefix", () => {
    expect(custodianMatches("fid", "fidelity")).toBe(false);
  });

  it("does not match unrelated custodians", () => {
    expect(custodianMatches("fidelity", "charles schwab")).toBe(false);
    expect(custodianMatches("bank of america", "bank of the west")).toBe(false);
  });
});
