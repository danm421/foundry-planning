// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { EstateTaxComparisonTable } from "../estate-tax-comparison-table";
import type { ProjectionResult } from "@/engine/projection";

const mkResult = (firstYear?: number, secondYear?: number, secondTax = 0, secondAdmin = 0): ProjectionResult =>
  ({
    firstDeathEvent: firstYear !== undefined
      ? { year: firstYear, federalEstateTax: 0, stateEstateTax: 0, estateAdminExpenses: 0 }
      : undefined,
    secondDeathEvent: secondYear !== undefined
      ? { year: secondYear, federalEstateTax: secondTax, stateEstateTax: 0, estateAdminExpenses: secondAdmin }
      : undefined,
  } as unknown as ProjectionResult);

describe("EstateTaxComparisonTable", () => {
  it("renders combined totals + delta row", () => {
    const { getByText, container } = render(
      <EstateTaxComparisonTable
        plan1Result={mkResult(2050, 2055, 49612900, 3292087)}
        plan2Result={mkResult(2050, 2055, 32225344, 2197130)}
        plan1Label="Base"
        plan2Label="Aggressive"
      />,
    );
    expect(getByText("Base")).toBeTruthy();
    expect(getByText("Aggressive")).toBeTruthy();
    expect(container.textContent).toContain("$52,904,987");
    expect(container.textContent).toContain("$34,422,474");
    expect(container.textContent).toContain("−$18,482,513");
  });

  it("shows '—' when a plan has no death within horizon", () => {
    const { container } = render(
      <EstateTaxComparisonTable
        plan1Result={mkResult(undefined, undefined)}
        plan2Result={mkResult(2050, 2055, 100, 0)}
        plan1Label="Base"
        plan2Label="Other"
      />,
    );
    expect(container.textContent).toContain("—");
  });
});
