// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

describe("TaxDrillDownModal tax-free partition", () => {
  // $50k muni + $10k inheritance: taxExemptInterest is a strict subset of
  // taxExempt, so the plain row must show the remainder, not the raw total.
  const detail = makeDetail({ taxExempt: 60_000, taxExemptInterest: 50_000 });

  it("renders both partitioned rows with the right label and amount", () => {
    render(
      <TaxDrillDownModal
        year={2030}
        detail={detail}
        accountNames={{}}
        incomes={[]}
        onClose={() => {}}
      />,
    );
    // Scope each amount to its own row — "Capital Gains (LT)" is also
    // $10,000 in this fixture, so an unscoped query would be ambiguous.
    const otherRow = screen.getByText("Other tax-free income").closest("button");
    expect(otherRow).not.toBeNull();
    expect(within(otherRow!).getByText("$10,000")).toBeDefined();

    const muniRow = screen.getByText("Municipal Bond Interest").closest("button");
    expect(muniRow).not.toBeNull();
    expect(within(muniRow!).getByText("$50,000")).toBeDefined();
  });

  it("sums the partitioned pair back to the Total Income footer", () => {
    render(
      <TaxDrillDownModal
        year={2030}
        detail={detail}
        accountNames={{}}
        incomes={[]}
        onClose={() => {}}
      />,
    );
    // 100,000 + 20,000 + 5,000 + 10,000 + 5,000 + 0 + 60,000 (taxExempt,
    // counted once) = 200,000 — the same total as before the split.
    expect(screen.getByText("Total Income")).toBeDefined();
    expect(screen.getByText("$200,000")).toBeDefined();
  });

  it("never shows the un-partitioned $60,000 double-count", () => {
    render(
      <TaxDrillDownModal
        year={2030}
        detail={detail}
        accountNames={{}}
        incomes={[]}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText("$60,000")).toBeNull();
  });
});
