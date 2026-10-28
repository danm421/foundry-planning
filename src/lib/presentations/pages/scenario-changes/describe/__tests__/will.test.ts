import { describe, it, expect } from "vitest";
import { describeChange } from "../index";
import { buildResolveContext } from "../resolve";

const resolve = buildResolveContext({
  accountsById: { roth: { name: "Roth 401(k)", category: "retirement" } },
  recipientsById: { "family_member:f1": "Jane Cooper", "family_member:f2": "John Cooper", "external_beneficiary:x1": "Marin Community Foundation" },
  entitiesById: {}, spouseName: "Susan", modelPortfoliosById: {}, baseAllocationsById: {},
});
const ctx = { targetNames: { "will:w1": "Cooper's will" }, resolve };

describe("will describer", () => {
  it("decomposes a bequests array diff into readable per-bequest lines (no [object Object])", () => {
    const row = describeChange({
      id: "c", scenarioId: "s", opType: "edit", targetKind: "will", targetId: "w1",
      toggleGroupId: null, orderIndex: 0,
      payload: { bequests: {
        from: [{ id: "b1", kind: "asset", assetMode: "all_assets", percentage: 1, condition: "always",
                 recipients: [{ recipientKind: "spouse", recipientId: null, percentage: 1 }] }],
        to: [
          { id: "b1", kind: "asset", assetMode: "all_assets", percentage: 1, condition: "always",
            recipients: [{ recipientKind: "spouse", recipientId: null, percentage: 1 }] },
          { id: "b2", kind: "asset", assetMode: "specific", accountId: "roth", percentage: 1, condition: "if_spouse_predeceased",
            recipients: [{ recipientKind: "family_member", recipientId: "f1", percentage: 0.5 },
                         { recipientKind: "family_member", recipientId: "f2", percentage: 0.5 }] },
        ],
      } },
    }, ctx);
    const joined = row.detail.join(" | ");
    expect(joined).not.toContain("[object Object]");
    expect(joined).toContain("Roth 401(k)");
    expect(joined).toContain("Jane Cooper");
    expect(joined).toContain("if Co-client predeceased");
    expect(row.detail.some((l) => /added/i.test(l))).toBe(true); // b2 is new
  });
});

describe("will describer — Other Heirs", () => {
  it("describes a will share to Other Heirs", () => {
    const row = describeChange({
      id: "c", scenarioId: "s", opType: "edit", targetKind: "will", targetId: "w1",
      toggleGroupId: null, orderIndex: 0,
      payload: { bequests: {
        from: [],
        to: [
          { id: "b1", kind: "asset", assetMode: "specific", accountId: "roth", percentage: 1, condition: "always",
            recipients: [{ recipientKind: "other_heirs", recipientId: null, percentage: 1 }] },
        ],
      } },
    }, ctx);
    const joined = row.detail.join(" | ");
    expect(joined).toContain("Other Heirs");
    expect(joined).not.toContain("a recipient");
  });
});

describe("will describer — dollar gifts", () => {
  const dollarRow = (recipients: { id: string; amount: number }[], over: Record<string, unknown> = {}) => describeChange({
    id: "c", scenarioId: "s", opType: "edit", targetKind: "will", targetId: "w1",
    toggleGroupId: null, orderIndex: 0,
    payload: { bequests: { from: [], to: [
      { id: "d1", kind: "dollar", assetMode: null, accountId: null, dollarSource: "estate", percentage: 100, condition: "always",
        recipients: recipients.map((r) => ({ recipientKind: "family_member", recipientId: r.id, percentage: 0, amount: r.amount })),
        ...over },
    ] } },
  }, ctx);

  it("renders a dollar gift", () => {
    expect(dollarRow([{ id: "f1", amount: 20_000 }, { id: "f2", amount: 20_000 }]).detail.join(" | "))
      .toContain("$20,000 each from cash & brokerage");
    const unequal = dollarRow([{ id: "f1", amount: 10_000 }, { id: "f2", amount: 5_000 }]).detail.join(" | ");
    expect(unequal).toContain("$15,000 total from cash & brokerage");
    expect(unequal).not.toMatch(/NaN|100%/);
    expect(dollarRow([{ id: "f1", amount: 20_000 }], { dollarSource: "account", accountId: "roth" }).detail.join(" | "))
      .toContain("$20,000 from Roth 401(k)");
  });
});
