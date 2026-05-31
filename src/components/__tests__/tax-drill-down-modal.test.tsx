// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaxDrillDownModal } from "../cashflow/tax-drill-down-modal";
import type { ProjectionYear } from "@/engine/types";

function makeDetail(
  over: Partial<NonNullable<ProjectionYear["taxDetail"]>> = {},
): NonNullable<ProjectionYear["taxDetail"]> {
  return {
    earnedIncome: 100_000,
    ordinaryIncome: 20_000,
    dividends: 5_000,
    capitalGains: 10_000,
    stCapitalGains: 5_000,
    qbi: 0,
    taxExempt: 2_000,
    taxExemptInterest: 0,
    bySource: {},
    ...over,
  } as NonNullable<ProjectionYear["taxDetail"]>;
}

describe("TaxDrillDownModal footer", () => {
  it("M3: footer is labeled 'Total Income' and equals the sum of the income rows", () => {
    render(
      <TaxDrillDownModal
        year={2030}
        detail={makeDetail()}
        accountNames={{}}
        incomes={[]}
        onClose={() => {}}
      />,
    );
    // 100,000 + 20,000 + 5,000 + 10,000 + 5,000 + 0 + 2,000 = 142,000
    expect(screen.getByText("Total Income")).toBeDefined();
    expect(screen.getByText("$142,000")).toBeDefined();
    expect(screen.queryByText("Total Taxes")).toBeNull();
  });
});
