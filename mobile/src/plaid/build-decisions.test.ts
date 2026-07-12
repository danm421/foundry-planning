import { describe, expect, it } from "vitest";
import type { PlaidMappedAccount } from "@contracts";
import { buildDecisions } from "@/plaid/build-decisions";

const checking: PlaidMappedAccount = { plaidAccountId: "p1", name: "Checking", mask: "1234", type: "depository", subtype: "checking", balance: 100 };
const card: PlaidMappedAccount = { plaidAccountId: "p2", name: "Card", mask: "9", type: "credit", subtype: "credit card", balance: -50 };

describe("buildDecisions", () => {
  it("excluded account → skip", () => {
    expect(buildDecisions([checking], { p1: { included: false } })).toEqual([{ plaidAccountId: "p1", action: "skip" }]);
  });
  it("included asset, no link target → create asset with suggested type", () => {
    expect(buildDecisions([checking], { p1: { included: true } })).toEqual([
      { plaidAccountId: "p1", action: "create", kind: "asset", name: "Checking", mask: "1234", balance: 100, category: "cash", subType: "checking" },
    ]);
  });
  it("included debt → create debt with suggested liabilityType", () => {
    expect(buildDecisions([card], { p2: { included: true } })).toEqual([
      { plaidAccountId: "p2", action: "create", kind: "debt", name: "Card", mask: "9", balance: -50, liabilityType: "credit_card" },
    ]);
  });
  it("included asset with link target → link", () => {
    expect(buildDecisions([checking], { p1: { included: true, linkTargetId: "acc9", linkKind: "account" } })).toEqual([
      { plaidAccountId: "p1", action: "link", existingAccountId: "acc9" },
    ]);
  });
  it("included debt with link target → link-liability", () => {
    expect(buildDecisions([card], { p2: { included: true, linkTargetId: "lia9", linkKind: "liability" } })).toEqual([
      { plaidAccountId: "p2", action: "link-liability", existingLiabilityId: "lia9" },
    ]);
  });
});
