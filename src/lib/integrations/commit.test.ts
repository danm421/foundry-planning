// src/lib/integrations/commit.test.ts
import { describe, it, expect } from "vitest";
import type { ExtractedAccount } from "@/lib/extraction/types";
import { buildReviewAccounts } from "./commit";

function pulled(externalId: string): ExtractedAccount {
  return {
    name: `Account ${externalId}`,
    category: "taxable",
    subType: "brokerage",
    externalProvider: "addepar",
    externalId,
    holdings: [],
  };
}

// a1 is tied to plan account plan-1. The untied plan account (no external id)
// must not capture anything.
const ties = [
  { id: "plan-1", externalId: "a1" },
  { id: "plan-hand-kept", externalId: null },
];

describe("buildReviewAccounts", () => {
  it("lists only the accounts no plan account is tied to, each as new", () => {
    const rows = buildReviewAccounts({ pulled: [pulled("a1"), pulled("a2")], ties });
    expect(rows.map((r) => [r.externalId, r.match])).toEqual([["a2", { kind: "new" }]]);
    // The pulled figures ride along untouched.
    expect(rows[0]).toMatchObject({ name: "Account a2", category: "taxable", subType: "brokerage" });
  });

  it("is empty once every pulled account is tied", () => {
    expect(buildReviewAccounts({ pulled: [pulled("a1")], ties })).toEqual([]);
  });
});
