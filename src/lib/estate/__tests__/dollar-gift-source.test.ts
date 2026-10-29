import { describe, expect, it } from "vitest";
import type { AccountOwner } from "@/engine/ownership";
import { DOLLAR_SOURCE_REFUSAL_TEXT, dollarSourceRefusal } from "../dollar-gift-source";

const client: AccountOwner = { kind: "family_member", familyMemberId: "fm-client", percent: 1 };
const trust = (entityId: string, percent: number): AccountOwner => ({ kind: "entity", entityId, percent });

describe("dollarSourceRefusal", () => {
  it("allows cash and brokerage the household owns", () => {
    expect(dollarSourceRefusal({ category: "cash", owners: [client] })).toBeNull();
    expect(dollarSourceRefusal({ category: "taxable", owners: [client] })).toBeNull();
    expect(dollarSourceRefusal({ category: "taxable", owners: [] })).toBeNull();
  });

  it.each(["retirement", "real_estate", "business", "life_insurance"])("refuses a %s account", (category) => {
    expect(dollarSourceRefusal({ category, owners: [client] })).toBe("dollar_bequest_source_not_cash");
  });

  it("refuses an account wholly owned by trusts, one or several", () => {
    expect(dollarSourceRefusal({ category: "taxable", owners: [trust("t-1", 1)] })).toBe("dollar_bequest_source_entity_owned");
    expect(dollarSourceRefusal({ category: "cash", owners: [trust("t-1", 0.5), trust("t-2", 0.5)] })).toBe(
      "dollar_bequest_source_entity_owned",
    );
  });

  it("allows an account a trust owns only part of: the engine pays from the household's share", () => {
    expect(dollarSourceRefusal({ category: "taxable", owners: [trust("t-1", 0.4), { ...client, percent: 0.6 }] })).toBeNull();
  });

  it("has plain words for every refusal", () => {
    for (const text of Object.values(DOLLAR_SOURCE_REFUSAL_TEXT)) expect(text).not.toMatch(/_/);
  });
});
