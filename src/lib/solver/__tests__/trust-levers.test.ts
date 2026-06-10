import { describe, it, expect } from "vitest";
import type { Account } from "@/engine/types";
import {
  buildTrustEntity,
  buildIlitFundingMutation,
  buildRetitleFundingMutation,
  buildRevertFundingMutation,
  isRetitleFundingEligible,
} from "../trust-levers";

function policy(): Account {
  return {
    id: "policy-1", name: "Term", category: "life_insurance",
    owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
    lifeInsurance: { premiumPayer: "owner" },
  } as unknown as Account;
}
function brokerage(): Account {
  return {
    id: "acct-1", name: "Brokerage", category: "taxable",
    owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
  } as unknown as Account;
}

describe("buildTrustEntity", () => {
  it("ILIT defaults: irrevocable, crummey, non-grantor, out of estate", () => {
    const e = buildTrustEntity({ id: "t1", name: "ILIT", subType: "ilit", grantor: "client" });
    expect(e).toMatchObject({ entityType: "trust", isIrrevocable: true, includeInPortfolio: false, crummeyPowers: true, isGrantor: false, trustSubType: "ilit" });
  });
  it("IDGT defaults: irrevocable grantor trust, no crummey", () => {
    const e = buildTrustEntity({ id: "t2", name: "IDGT", subType: "idgt", grantor: "spouse" });
    expect(e).toMatchObject({ isGrantor: true, crummeyPowers: false, isIrrevocable: true, trustSubType: "idgt", grantor: "spouse" });
  });
  it("plain irrevocable: non-grantor, no crummey", () => {
    const e = buildTrustEntity({ id: "t3", name: "Trust", subType: "irrevocable", grantor: "client" });
    expect(e).toMatchObject({ isGrantor: false, crummeyPowers: false, isIrrevocable: true, trustSubType: "irrevocable" });
  });
});

describe("buildIlitFundingMutation", () => {
  it("retitles the policy to the entity, seeds the trust as primary beneficiary, and sets premiumPayer to the grantor", () => {
    const m = buildIlitFundingMutation(policy(), "t1", "client", "ben-1");
    expect(m.kind).toBe("account-upsert");
    const v = (m as { value: Account }).value;
    expect(v.owners).toEqual([{ kind: "entity", entityId: "t1", percent: 1 }]);
    expect(v.lifeInsurance?.premiumPayer).toBe("client");
    expect(v.beneficiaries).toEqual([{ id: "ben-1", tier: "primary", percentage: 100, entityIdRef: "t1", sortOrder: 0 }]);
  });
});

describe("buildRetitleFundingMutation / revert", () => {
  it("retitles a household account to the entity", () => {
    const m = buildRetitleFundingMutation(brokerage(), "t2");
    expect((m as { value: Account }).value.owners).toEqual([{ kind: "entity", entityId: "t2", percent: 1 }]);
  });
  it("revert restores the original account verbatim", () => {
    const orig = brokerage();
    const m = buildRevertFundingMutation(orig);
    expect((m as { value: Account }).value).toEqual(orig);
  });
});

describe("isRetitleFundingEligible", () => {
  it("accepts a household-owned, non-insurance account", () => {
    expect(isRetitleFundingEligible(brokerage())).toBe(true);
  });
  it("rejects a life-insurance account (ILIT path handles those)", () => {
    expect(isRetitleFundingEligible(policy())).toBe(false);
  });
});
