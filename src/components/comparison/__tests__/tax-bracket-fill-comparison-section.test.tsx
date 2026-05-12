// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Bar } from "react-chartjs-2";
import { TaxBracketFillComparisonSection } from "../tax-bracket-fill-comparison-section";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { BracketTier, TaxYearParameters } from "@/lib/tax/types";

vi.mock("react-chartjs-2", () => ({
  Bar: vi.fn(() => <div data-testid="chart" />),
}));

const MFJ: BracketTier[] = [
  { from: 0, to: 23200, rate: 0.10 },
  { from: 23200, to: 94300, rate: 0.12 },
  { from: 94300, to: null, rate: 0.22 },
];

function mkPlan(label: string, samples: Array<{ year: number; incomeTaxBase: number; marginal: BracketTier }>): ComparisonPlan {
  const params = {
    year: 2030,
    incomeBrackets: { married_joint: MFJ, single: MFJ, head_of_household: MFJ, married_separate: MFJ },
  } as TaxYearParameters;
  return {
    index: 0,
    isBaseline: true,
    ref: { kind: "scenario", id: label },
    id: label,
    label,
    tree: {} as ComparisonPlan["tree"],
    result: {
      years: samples.map((s) => ({
        year: s.year,
        ages: { client: 60 },
        taxResult: {
          flow: { incomeTaxBase: s.incomeTaxBase } as ComparisonPlan["result"]["years"][number]["taxResult"]["flow"],
          diag: { marginalFederalRate: s.marginal.rate, marginalBracketTier: s.marginal, bracketsUsed: params },
        },
        rothConversions: [],
      })) as ComparisonPlan["result"]["years"],
    } as ComparisonPlan["result"],
    lifetime: {} as ComparisonPlan["lifetime"],
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
  };
}

describe("TaxBracketFillComparisonSection", () => {
  it("renders one chart per plan", () => {
    render(
      <TaxBracketFillComparisonSection
        plans={[
          mkPlan("A", [{ year: 2030, incomeTaxBase: 50_000, marginal: MFJ[1] }]),
          mkPlan("B", [{ year: 2030, incomeTaxBase: 150_000, marginal: MFJ[2] }]),
        ]}
        yearRange={null}
      />,
    );
    expect(screen.getAllByTestId("chart")).toHaveLength(2);
  });

  it("includes one stepped-line dataset per non-top bracket rate (bracket tops)", () => {
    (Bar as unknown as ReturnType<typeof vi.fn>).mockClear();
    render(
      <TaxBracketFillComparisonSection
        plans={[
          mkPlan("A", [
            { year: 2030, incomeTaxBase: 50_000, marginal: MFJ[1] },
            { year: 2031, incomeTaxBase: 60_000, marginal: MFJ[1] },
          ]),
        ]}
        yearRange={null}
      />,
    );
    const datasets = (Bar as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]
      .data.datasets;
    const lineDatasets = datasets.filter((d: { type?: string }) => d.type === "line");
    expect(lineDatasets.length).toBeGreaterThan(0);
    for (const d of lineDatasets) {
      expect(d.stepped).toBe("before");
      expect(d.borderDash).toEqual([4, 4]);
    }
  });

  it("renders an empty state when every clipped year is missing taxResult or zero", () => {
    const plan: ComparisonPlan = {
      ...mkPlan("A", []),
    };
    render(<TaxBracketFillComparisonSection plans={[plan]} yearRange={null} />);
    expect(screen.getByText(/No taxable income/i)).toBeTruthy();
  });
});
