// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, within } from "@testing-library/react";
import type { ProjectionYear } from "@/engine";
import type { TaxResult, BracketTier } from "@/lib/tax/types";
import { TaxBracketChart } from "../tax-bracket-chart";
import { makeYear as makeBareYear } from "./fixtures";

const mfjBrackets: BracketTier[] = [
  { from: 0, to: 23_200, rate: 0.1 },
  { from: 23_200, to: 94_300, rate: 0.12 },
  { from: 94_300, to: 201_050, rate: 0.22 },
  { from: 201_050, to: 383_900, rate: 0.24 },
  { from: 383_900, to: null, rate: 0.37 },
];

function makeYear(year: number, incomeTaxBase: number, conversionTaxable = 0): ProjectionYear {
  const tier = mfjBrackets.find((t) => t.to == null || incomeTaxBase < t.to)!;
  return makeBareYear({
    year,
    taxResult: {
      flow: { incomeTaxBase, amtAdditional: 0 } as TaxResult["flow"],
      diag: {
        marginalFederalRate: tier.rate,
        marginalBracketTier: tier,
        incomeBracketsForFiling: mfjBrackets,
        effectiveFederalRate: 0,
      } as TaxResult["diag"],
    } as TaxResult,
    rothConversions:
      conversionTaxable > 0
        ? [{ id: "rc1", name: "Roth conversion", gross: conversionTaxable, taxable: conversionTaxable, requested: conversionTaxable, limitedBy: null }]
        : undefined,
  });
}

describe("TaxBracketChart legend", () => {
  it("names the bars and every floor drawn, as real text under the canvas", () => {
    const { container, getByText } = render(
      <TaxBracketChart years={[makeYear(2026, 120_000, 40_000), makeYear(2027, 130_000)]} />,
    );
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(getByText("Income tax base")).toBeTruthy();
    expect(getByText("Taxable Roth conversion")).toBeTruthy();
    // Income sits in the 22% tier: the 12%, 22% and 24% floors are on the
    // chart; 10% ($0) and 37% (above the ceiling) are not.
    const floors = within(container.querySelector('ul[aria-label="Bracket floors"]')!);
    expect(floors.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["12%", "22%", "24%"]);
  });

  it("leaves the conversion series out of the legend when no year converts", () => {
    const { queryByText } = render(<TaxBracketChart years={[makeYear(2026, 120_000)]} />);
    expect(queryByText("Taxable Roth conversion")).toBeNull();
    expect(queryByText("Income tax base")).toBeTruthy();
  });
});
