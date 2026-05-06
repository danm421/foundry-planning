import { describe, it, expect } from "vitest";
import { computeIrdAttributions } from "../ird-tax";
import type { Account, DeathTransfer } from "../../types";

const acct = (id: string, subType: Account["subType"]): Account => ({
  id,
  name: id,
  category: "retirement",
  subType,
  ownerType: "individual",
  ownerId: "fm-c",
  balance: 0,
  basis: 0,
  growthRate: 0,
} as unknown as Account);

const transfer = (
  partial: Partial<DeathTransfer> & Pick<DeathTransfer, "recipientKind" | "amount">,
): DeathTransfer => ({
  via: "beneficiary_designation",
  sourceAccountId: "ira-1",
  sourceAccountName: "IRA",
  sourceLiabilityId: null,
  sourceLiabilityName: null,
  recipientId: null,
  recipientLabel: "Recipient",
  basis: 0,
  resultingAccountId: null,
  resultingLiabilityId: null,
  ...partial,
}) as DeathTransfer;

describe("computeIrdAttributions", () => {
  it("applies IRD to a non-spouse child receiving a traditional IRA", () => {
    const out = computeIrdAttributions({
      deathOrder: 1,
      transfers: [
        transfer({ recipientKind: "family_member", recipientId: "fm-child", amount: 100_000, sourceAccountId: "ira-1" }),
      ],
      accounts: [acct("ira-1", "traditional_ira")],
      externalBeneficiaries: [],
      irdTaxRate: 0.35,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      drainKind: "ird_tax",
      recipientKind: "family_member",
      recipientId: "fm-child",
      deathOrder: 1,
    });
    expect(out[0].amount).toBeCloseTo(35_000, 2);
  });

  it("emits no IRD for spouse recipient", () => {
    const out = computeIrdAttributions({
      deathOrder: 1,
      transfers: [
        transfer({ recipientKind: "spouse", recipientId: null, amount: 100_000, sourceAccountId: "ira-1" }),
      ],
      accounts: [acct("ira-1", "traditional_ira")],
      externalBeneficiaries: [],
      irdTaxRate: 0.35,
    });
    expect(out).toEqual([]);
  });

  it("splits 50/50 spouse/child — only the child's $50k attracts IRD", () => {
    const out = computeIrdAttributions({
      deathOrder: 1,
      transfers: [
        transfer({ recipientKind: "spouse", recipientId: null, amount: 50_000, sourceAccountId: "ira-1" }),
        transfer({ recipientKind: "family_member", recipientId: "fm-child", amount: 50_000, sourceAccountId: "ira-1" }),
      ],
      accounts: [acct("ira-1", "traditional_ira")],
      externalBeneficiaries: [],
      irdTaxRate: 0.35,
    });
    expect(out).toHaveLength(1);
    expect(out[0].recipientId).toBe("fm-child");
    expect(out[0].amount).toBeCloseTo(17_500, 2);
  });

  it("excludes charitable external beneficiaries", () => {
    const out = computeIrdAttributions({
      deathOrder: 1,
      transfers: [
        transfer({ recipientKind: "external_beneficiary", recipientId: "ext-charity", amount: 100_000, sourceAccountId: "ira-1" }),
      ],
      accounts: [acct("ira-1", "traditional_ira")],
      externalBeneficiaries: [
        { id: "ext-charity", name: "Red Cross", kind: "charity" },
      ],
      irdTaxRate: 0.35,
    });
    expect(out).toEqual([]);
  });

  it("includes non-charity external beneficiaries", () => {
    const out = computeIrdAttributions({
      deathOrder: 1,
      transfers: [
        transfer({ recipientKind: "external_beneficiary", recipientId: "ext-friend", amount: 100_000, sourceAccountId: "ira-1" }),
      ],
      accounts: [acct("ira-1", "traditional_ira")],
      externalBeneficiaries: [
        { id: "ext-friend", name: "Friend", kind: "individual" },
      ],
      irdTaxRate: 0.35,
    });
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBeCloseTo(35_000, 2);
  });

  it("does not apply IRD to roth_ira", () => {
    const out = computeIrdAttributions({
      deathOrder: 1,
      transfers: [
        transfer({ recipientKind: "family_member", recipientId: "fm-child", amount: 100_000, sourceAccountId: "roth-1" }),
      ],
      accounts: [acct("roth-1", "roth_ira")],
      externalBeneficiaries: [],
      irdTaxRate: 0.35,
    });
    expect(out).toEqual([]);
  });

  it("does not apply IRD to brokerage", () => {
    const out = computeIrdAttributions({
      deathOrder: 1,
      transfers: [
        transfer({ recipientKind: "family_member", recipientId: "fm-child", amount: 100_000, sourceAccountId: "brk-1" }),
      ],
      accounts: [{ ...acct("brk-1", "brokerage"), category: "taxable" } as Account],
      externalBeneficiaries: [],
      irdTaxRate: 0.35,
    });
    expect(out).toEqual([]);
  });

  it("returns [] when rate is 0", () => {
    const out = computeIrdAttributions({
      deathOrder: 1,
      transfers: [
        transfer({ recipientKind: "family_member", recipientId: "fm-child", amount: 100_000, sourceAccountId: "ira-1" }),
      ],
      accounts: [acct("ira-1", "traditional_ira")],
      externalBeneficiaries: [],
      irdTaxRate: 0,
    });
    expect(out).toEqual([]);
  });

  it("applies IRD when 401k passes to a trust entity", () => {
    const out = computeIrdAttributions({
      deathOrder: 2,
      transfers: [
        transfer({ recipientKind: "entity", recipientId: "ent-trust", amount: 200_000, sourceAccountId: "401k-1" }),
      ],
      accounts: [acct("401k-1", "401k")],
      externalBeneficiaries: [],
      irdTaxRate: 0.40,
    });
    expect(out).toHaveLength(1);
    expect(out[0].recipientKind).toBe("entity");
    expect(out[0].amount).toBeCloseTo(80_000, 2);
    expect(out[0].deathOrder).toBe(2);
  });

  it("applies IRD on 403(b) accounts", () => {
    const out = computeIrdAttributions({
      deathOrder: 2,
      transfers: [
        transfer({ recipientKind: "family_member", recipientId: "fm-child", amount: 100_000, sourceAccountId: "403b-1" }),
      ],
      accounts: [acct("403b-1", "403b")],
      externalBeneficiaries: [],
      irdTaxRate: 0.30,
    });
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBeCloseTo(30_000, 2);
  });

  it("aggregates multiple transfers to the same recipient into one attribution", () => {
    const out = computeIrdAttributions({
      deathOrder: 2,
      transfers: [
        transfer({ recipientKind: "family_member", recipientId: "fm-child", amount: 60_000, sourceAccountId: "ira-1" }),
        transfer({ recipientKind: "family_member", recipientId: "fm-child", amount: 40_000, sourceAccountId: "401k-1" }),
      ],
      accounts: [acct("ira-1", "traditional_ira"), acct("401k-1", "401k")],
      externalBeneficiaries: [],
      irdTaxRate: 0.25,
    });
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBeCloseTo(25_000, 2);
  });

  it("ignores transfers with non-positive amount or null sourceAccountId", () => {
    const out = computeIrdAttributions({
      deathOrder: 1,
      transfers: [
        transfer({ recipientKind: "family_member", recipientId: "fm-child", amount: 0, sourceAccountId: "ira-1" }),
        transfer({ recipientKind: "family_member", recipientId: "fm-child", amount: -10_000, sourceAccountId: "ira-1" }),
        transfer({ recipientKind: "family_member", recipientId: "fm-child", amount: 100_000, sourceAccountId: null }),
      ],
      accounts: [acct("ira-1", "traditional_ira")],
      externalBeneficiaries: [],
      irdTaxRate: 0.35,
    });
    expect(out).toEqual([]);
  });
});
