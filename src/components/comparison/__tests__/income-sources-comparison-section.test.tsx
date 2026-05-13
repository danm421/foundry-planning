// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { IncomeSourcesComparisonSection } from "../income-sources-comparison-section";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

function mkPlan(
  label: string,
  incomes: Array<unknown>,
  years: Array<unknown> = [],
  entities: Array<unknown> = [],
): ComparisonPlan {
  return {
    index: 0,
    isBaseline: true,
    ref: { kind: "scenario", id: label },
    id: label,
    label,
    tree: { incomes, entities } as unknown as ComparisonPlan["tree"],
    result: { years } as unknown as ComparisonPlan["result"],
    lifetime: {} as ComparisonPlan["lifetime"],
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
    allocation: null,
  };
}

describe("IncomeSourcesComparisonSection", () => {
  it("derives Start/End/First-Year from projection's bySource amounts", () => {
    // Salary pays 2025–2027 at 200k flat. SS claim age delays the engine's
    // payout until 2042 — even though both rows have startYear=2025 in the
    // raw data, the widget should pick up the actual paying range from the
    // projection result.
    const plan = mkPlan(
      "A",
      [
        {
          id: "salary",
          name: "Cooper's Salary",
          type: "salary",
          annualAmount: 200_000,
          startYear: 2025,
          endYear: 2027,
          growthRate: 0,
        },
        {
          id: "ss",
          name: "Cooper's Social Security",
          type: "social_security",
          annualAmount: 0,
          startYear: 2025, // raw data start — engine ignores this for SS
          endYear: 2075,
          growthRate: 0,
          claimingAge: 67,
          piaMonthly: 2_500,
          ssBenefitMode: "pia_at_fra",
        },
      ],
      [
        { year: 2025, income: { bySource: { salary: 200_000, ss: 0 } } },
        { year: 2026, income: { bySource: { salary: 200_000, ss: 0 } } },
        { year: 2027, income: { bySource: { salary: 200_000, ss: 0 } } },
        { year: 2042, income: { bySource: { salary: 0, ss: 30_000 } } },
        { year: 2043, income: { bySource: { salary: 0, ss: 30_900 } } },
        { year: 2075, income: { bySource: { salary: 0, ss: 55_000 } } },
      ],
    );
    render(<IncomeSourcesComparisonSection plans={[plan]} />);
    const salaryRow = screen.getByText("Cooper's Salary").closest("tr")!;
    const salaryCells = within(salaryRow).getAllByRole("cell");
    expect(salaryCells[2].textContent).toBe("$200,000");
    expect(salaryCells[3].textContent).toBe("2025");
    expect(salaryCells[4].textContent).toBe("2027");

    const ssRow = screen.getByText("Cooper's Social Security").closest("tr")!;
    const ssCells = within(ssRow).getAllByRole("cell");
    expect(ssCells[2].textContent).toBe("$30,000");
    expect(ssCells[3].textContent).toBe("2042");
    expect(ssCells[4].textContent).toBe("2075");
  });

  it("falls back to the income definition when projection has no positive amounts for that row", () => {
    // No projection coverage -> compute first-year from definition:
    //   100,000 * (1.03)^5 ≈ 115,927, starting in 2030, ending 2040.
    const plan = mkPlan("A", [
      {
        id: "i1",
        name: "Cooper's Salary",
        type: "salary",
        annualAmount: 100_000,
        startYear: 2030,
        endYear: 2040,
        growthRate: 0.03,
        inflationStartYear: 2025,
      },
    ]);
    render(<IncomeSourcesComparisonSection plans={[plan]} />);
    const row = screen.getByText("Cooper's Salary").closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    expect(cells[2].textContent).toBe("$115,927");
    expect(cells[3].textContent).toBe("2030");
    expect(cells[4].textContent).toBe("2040");
  });

  it("shows 'Schedule' for incomes with scheduleOverrides instead of a single first-year amount", () => {
    const plan = mkPlan(
      "A",
      [
        {
          id: "i1",
          name: "Lumpy Business Income",
          type: "business",
          annualAmount: 0,
          startYear: 2030,
          endYear: 2035,
          growthRate: 0,
          scheduleOverrides: { 2030: 0, 2031: 100_000, 2032: 50_000 },
        },
      ],
      [
        { year: 2030, income: { bySource: { i1: 0 } } },
        { year: 2031, income: { bySource: { i1: 100_000 } } },
        { year: 2032, income: { bySource: { i1: 50_000 } } },
      ],
    );
    render(<IncomeSourcesComparisonSection plans={[plan]} />);
    const row = screen.getByText("Lumpy Business Income").closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    expect(cells[2].textContent).toBe("Schedule");
    // Start/End still scan the projection for the actual paying range.
    expect(cells[3].textContent).toBe("2031");
    expect(cells[4].textContent).toBe("2032");
  });

  it("shows 'Schedule' for entity-owned business incomes when the entity uses flowMode='schedule'", () => {
    const plan = mkPlan(
      "A",
      [
        {
          id: "i1",
          name: "S-Corp Distribution",
          type: "business",
          annualAmount: 0,
          startYear: 2030,
          endYear: 2040,
          growthRate: 0,
          ownerEntityId: "ent-scorp",
        },
      ],
      [{ year: 2030, income: { bySource: { i1: 75_000 } } }],
      [{ id: "ent-scorp", name: "Acme S-Corp", flowMode: "schedule" }],
    );
    render(<IncomeSourcesComparisonSection plans={[plan]} />);
    const row = screen.getByText("S-Corp Distribution").closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    expect(cells[2].textContent).toBe("Schedule");
  });

  it("renders empty state when no incomes", () => {
    const plan = mkPlan("A", []);
    render(<IncomeSourcesComparisonSection plans={[plan]} />);
    expect(screen.getByText(/No income sources/i)).toBeTruthy();
  });
});
