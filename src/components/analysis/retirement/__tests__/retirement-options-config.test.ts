import { describe, it, expect } from "vitest";
import {
  buildExploreRows,
  savingsColumnAccountId,
  SOLVED_COLUMNS,
} from "../retirement-options-config";
import { SYNTHETIC_SAVINGS_ACCOUNT_ID } from "@/lib/analysis/hypothetical-savings";
import { buildClientData, sampleSavingsRules } from "@/engine/__tests__/fixtures";

describe("retirement-options-config — min-savings → taxable-savings row", () => {
  it("min-savings column highlights the taxable-contributions row", () => {
    const minSavings = SOLVED_COLUMNS.find((c) => c.id === "min-savings");
    expect(minSavings?.highlightRow).toBe("taxable-contributions");
  });

  it("emits a synthetic taxable-savings row when the client has no real taxable rule", () => {
    // Default fixture has only a pre-tax 401k savings rule — no taxable rule.
    const rows = buildExploreRows(buildClientData());
    const taxableRow = rows.find((r) => r.key === "taxable-contributions");
    expect(taxableRow).toBeDefined();
    expect(taxableRow?.label).toBe("Additional Taxable Savings");
    expect(taxableRow?.currentValue).toBe(0);
    expect(taxableRow?.targetId).toBe(SYNTHETIC_SAVINGS_ACCOUNT_ID);
    // savingsColumnAccountId now points at the synthetic account (non-empty, so
    // the min-savings column always solves).
    expect(savingsColumnAccountId(rows)).toBe(SYNTHETIC_SAVINGS_ACCOUNT_ID);
  });

  it("uses the real taxable savings rule when one exists", () => {
    const tree = buildClientData({
      savingsRules: [
        ...sampleSavingsRules,
        {
          id: "sav-tax",
          accountId: "acct-brokerage", // taxable account in the fixture
          annualAmount: 10_000,
          isDeductible: false,
          startYear: 2026,
          endYear: 2035,
        },
      ],
    });
    const rows = buildExploreRows(tree);
    const taxableRow = rows.find((r) => r.key === "taxable-contributions");
    expect(taxableRow?.label).toBe("Taxable Contributions");
    expect(taxableRow?.currentValue).toBe(10_000);
    expect(taxableRow?.targetId).toBe("acct-brokerage");
  });
});
