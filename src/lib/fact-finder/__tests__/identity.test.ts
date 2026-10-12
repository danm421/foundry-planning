// src/lib/fact-finder/__tests__/identity.test.ts
import { describe, expect, it } from "vitest";
import { FACT_FINDER_SECTIONS } from "../schema";
import { hasIdentityRule, last4Of, sameIdentity } from "../identity";

describe("sameIdentity", () => {
  it("has a rule for every section whose rows come and go", () => {
    for (const s of FACT_FINDER_SECTIONS.filter((x) => x.layout === "list" || x.layout === "transposed")) {
      expect(hasIdentityRule(s.id), s.id).toBe(true);
    }
  });

  it("matches accounts on last 4, refusing a contradicting custodian", () => {
    expect(sameIdentity("retirement", { last4: "x2201", custodian: "Fidelity" }, { last4: "2201", custodian: "Fidelity Investments" })).toBe(true);
    expect(sameIdentity("taxable", { last4: "7731", custodian: "Schwab" }, { last4: "7731", custodian: "Charles Schwab & Co., Inc." })).toBe(true);
    expect(sameIdentity("retirement", { last4: "2201", custodian: "Fidelity" }, { last4: "2201", custodian: "Vanguard" })).toBe(false);
    expect(sameIdentity("retirement", { last4: "2201" }, { last4: "2202" })).toBe(false);
  });

  it("needs owners to agree only when matching accounts by name", () => {
    expect(sameIdentity("retirement", { accountName: "Roth IRA", owner: "Client" }, { accountName: "Roth IRA", owner: "Co-client" })).toBe(false);
    expect(sameIdentity("retirement", { accountName: "Roth IRA", owner: "Client" }, { accountName: "Roth IRA" })).toBe(true);
    expect(sameIdentity("retirement", { last4: "2201", owner: "Client" }, { last4: "2201", owner: "Co-client" })).toBe(true);
  });

  it("falls back to the account name when either side has no last 4", () => {
    expect(sameIdentity("taxable", { accountName: "Joint Brokerage" }, { accountName: "joint  brokerage", last4: "7731" })).toBe(true);
    expect(sameIdentity("taxable", { accountName: "Brokerage" }, { accountName: "Trust Brokerage" })).toBe(false);
    expect(sameIdentity("annuity", { contractName: "Jackson VA" }, { contractName: "Jackson VA" })).toBe(true);
  });

  it("matches family on first name plus date of birth, else last name", () => {
    expect(sameIdentity("family", { firstName: "Emma", dateOfBirth: "2004-05-21" }, { firstName: "emma", dateOfBirth: "2004-05-21" })).toBe(true);
    expect(sameIdentity("family", { firstName: "Emma", dateOfBirth: "2004-05-21" }, { firstName: "Emma", dateOfBirth: "2006-01-01" })).toBe(false);
    expect(sameIdentity("family", { firstName: "Emma", lastName: "Hendricks" }, { firstName: "Emma" })).toBe(true);
  });

  it("matches life policies on policy number, including a printed last 4", () => {
    expect(sameIdentity("life", { policyNumber: "NM-55820013" }, { policyNumber: "0013" })).toBe(true);
    expect(sameIdentity("life", { policyNumber: "NM-55820013" }, { policyNumber: "NM-1" })).toBe(false);
    expect(sameIdentity("life", { carrier: "Unum", insured: "Client" }, { carrier: "unum", insured: "Client" })).toBe(true);
  });

  it("matches income on name plus any owner and type both sides have", () => {
    expect(sameIdentity("income", { incomeName: "Pension", owner: "Client" }, { incomeName: "pension", owner: "Client", type: "Other" })).toBe(true);
    expect(sameIdentity("income", { incomeName: "Pension", owner: "Client" }, { incomeName: "Pension", owner: "Co-client" })).toBe(false);
  });

  it("never matches on a blank identity", () => {
    expect(sameIdentity("liab", {}, {})).toBe(false);
    expect(sameIdentity("gifts", { year: 2022 }, { year: 2022 })).toBe(false);
  });

  it("reads last 4 from any printed form", () => {
    expect(last4Of("xxxx-2201")).toBe("2201");
    expect(last4Of("12")).toBe("");
    expect(last4Of(null)).toBe("");
  });
});
