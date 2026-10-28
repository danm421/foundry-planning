import { describe, it, expect } from "vitest";
import type { Account, ClientData, EntitySummary, Will } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { makeEntityCheckingAccount } from "@/lib/entities/entity-checking";
import { remainderSummary, trustFundingSummary } from "../trust-overview";

const trust: EntitySummary = {
  id: "t1",
  name: "Sam Rivera Irrevocable Trust",
  entityType: "trust",
  trustSubType: "irrevocable",
  isIrrevocable: true,
  isGrantor: true,
  includeInPortfolio: false,
  grantor: "client",
};

const brokerage = {
  id: "a-brk",
  name: "Joint Brokerage",
  category: "taxable",
  value: 640_000,
  owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }],
} as unknown as Account;

function tree(over: Partial<ClientData> = {}): ClientData {
  return {
    client: { firstName: "Alex", lastName: "Rivera", spouseName: "Jordan", spouseDob: "1970-03-02" },
    accounts: [brokerage],
    entities: [trust],
    familyMembers: [
      { id: "fm-c", role: "client", firstName: "Alex", lastName: "Rivera" },
      { id: "fm-s", role: "spouse", firstName: "Jordan", lastName: "Rivera" },
      { id: "fm-1", role: "child", firstName: "Sam", lastName: "Rivera" },
      { id: "fm-2", role: "child", firstName: "Pat", lastName: "Rivera" },
    ],
    externalBeneficiaries: [{ id: "x-1", name: "Red Cross", kind: "charity", charityType: "public" }],
    wills: [],
    ...over,
  } as unknown as ClientData;
}

const cashGift = (over: Partial<EstateFlowGift> = {}): EstateFlowGift =>
  ({
    kind: "cash-once",
    id: "g1",
    year: 2026,
    amount: 1_000_000,
    grantor: "client",
    recipient: { kind: "entity", id: "t1" },
    crummey: false,
    ...over,
  }) as EstateFlowGift;

function will(grantor: "client" | "spouse", bequests: Partial<Will["bequests"][number]>[]): Will {
  return {
    id: `w-${grantor}`,
    grantor,
    bequests: bequests.map((b, i) => ({
      id: `b-${grantor}-${i}`,
      name: "Bequest",
      kind: "asset",
      assetMode: "specific",
      accountId: "a-brk",
      entityId: null,
      liabilityId: null,
      percentage: 100,
      condition: "always",
      sortOrder: i,
      recipients: [{ recipientKind: "entity", recipientId: "t1", percentage: 100, sortOrder: 0 }],
      ...b,
    })),
  };
}

describe("trustFundingSummary", () => {
  it("says the trust isn't funded when nothing names it", () => {
    expect(trustFundingSummary(trust, tree(), [])).toBe("Not funded yet");
  });

  it("names a gift into the trust", () => {
    expect(trustFundingSummary(trust, tree(), [cashGift()])).toBe("Gift $1,000,000 · 2026");
  });

  it("ignores gifts to someone else and gifts switched off", () => {
    const toChild = cashGift({ id: "g2", recipient: { kind: "family_member", id: "fm-1" } });
    const off = cashGift({ id: "g3", enabled: false });
    expect(trustFundingSummary(trust, tree(), [toChild, off])).toBe("Not funded yet");
  });

  it("shows the first item and counts the rest", () => {
    const second = cashGift({ id: "g2", amount: 19_000, year: 2027 });
    expect(trustFundingSummary(trust, tree(), [cashGift(), second])).toBe(
      "Gift $1,000,000 · 2026 +1 more",
    );
  });

  it("names a will bequest naming the trust", () => {
    const t = tree({ wills: [will("client", [{ percentage: 50 }])] });
    expect(trustFundingSummary(trust, t, [])).toBe("Bequest · 50% of Joint Brokerage · Alex's will, either way");
  });

  it("reads a second-death pair from both wills as one bequest", () => {
    const t = tree({
      wills: [
        will("client", [{ assetMode: "all_assets", accountId: null, condition: "if_spouse_predeceased" }]),
        will("spouse", [{ assetMode: "all_assets", accountId: null, condition: "if_spouse_predeceased" }]),
      ],
    });
    expect(trustFundingSummary(trust, t, [])).toBe("Bequest · everything · whoever dies second");
  });

  it("skips a bequest naming another trust", () => {
    const t = tree({
      wills: [
        will("client", [
          { recipients: [{ recipientKind: "entity", recipientId: "t-other", percentage: 100, sortOrder: 0 }] },
        ]),
      ],
    });
    expect(trustFundingSummary(trust, t, [])).toBe("Not funded yet");
  });

  it("names an account the trust holds, but never its own cash account", () => {
    const held = {
      ...brokerage,
      id: "a-held",
      name: "Trust Brokerage",
      owners: [{ kind: "entity", entityId: "t1", percent: 1 }],
    } as unknown as Account;
    const t = tree({ accounts: [brokerage, makeEntityCheckingAccount("t1", trust.name), held] });
    expect(trustFundingSummary(trust, t, [])).toBe("Holds Trust Brokerage");
  });

  it("lists gifts, then bequests, then held accounts", () => {
    const held = {
      ...brokerage,
      id: "a-held",
      owners: [{ kind: "entity", entityId: "t1", percent: 1 }],
    } as unknown as Account;
    const t = tree({ accounts: [brokerage, held], wills: [will("client", [{}])] });
    expect(trustFundingSummary(trust, t, [cashGift()])).toBe("Gift $1,000,000 · 2026 +2 more");
    expect(trustFundingSummary(trust, t, [])).toBe("Bequest · 100% of Joint Brokerage · Alex's will, either way +1 more");
  });
});

describe("remainderSummary", () => {
  it("is a dash when nobody gets what's left", () => {
    expect(remainderSummary(trust, tree())).toBe("—");
  });

  it("lists the remainder beneficiaries by first name", () => {
    const e: EntitySummary = {
      ...trust,
      remainderBeneficiaries: [
        { familyMemberId: "fm-1", percentage: 50, distributionForm: "outright" },
        { familyMemberId: "fm-2", percentage: 50, distributionForm: "outright" },
      ],
    };
    expect(remainderSummary(e, tree())).toBe("Sam, Pat");
  });

  it("names household members, outside beneficiaries and Other heirs", () => {
    const e: EntitySummary = {
      ...trust,
      remainderBeneficiaries: [
        { householdRole: "spouse", percentage: 25, distributionForm: "outright" },
        { externalBeneficiaryId: "x-1", percentage: 25, distributionForm: "outright" },
        { otherHeirs: true, percentage: 50, distributionForm: "outright" },
      ],
    };
    expect(remainderSummary(e, tree())).toBe("Jordan, Red Cross, Other heirs");
  });

  it("names a CRT's charity as who gets what's left", () => {
    const crt = {
      ...trust,
      trustSubType: "crt",
      splitInterest: { charityId: "x-1" },
    } as unknown as EntitySummary;
    expect(remainderSummary(crt, tree())).toBe("Red Cross");
  });
});
