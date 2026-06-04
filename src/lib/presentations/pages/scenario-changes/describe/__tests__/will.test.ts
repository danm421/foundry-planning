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
    expect(joined).toContain("if spouse predeceased");
    expect(row.detail.some((l) => /added/i.test(l))).toBe(true); // b2 is new
  });
});
