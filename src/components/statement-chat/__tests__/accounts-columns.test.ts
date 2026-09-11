import { describe, it, expect } from "vitest";
import { accountTypeLabel } from "../accounts-columns";

/**
 * Task 10 review, Important 9: the Account-type cell's display label must
 * come from the canonical `formatAccountCategory`/`formatAccountSubType`
 * formatters in `src/lib/accounts/category-labels.ts`, not from a `.find()`
 * scan of the dropdown's own curated (and slightly differently worded)
 * option list. "s_corp" is the case that tells them apart: the dropdown's
 * hand-written label is "S-Corp" (hyphen); the canonical formatter's is
 * "S Corp" (space).
 */
describe("accountTypeLabel", () => {
  it("uses the canonical formatter's wording, not the dropdown option list's", () => {
    expect(accountTypeLabel({ name: "x", category: "business", subType: "s_corp" } as never)).toBe(
      "Business · S Corp",
    );
  });
});
