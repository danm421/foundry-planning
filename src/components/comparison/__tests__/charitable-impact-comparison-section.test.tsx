// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CharitableImpactComparisonSection } from "../charitable-impact-comparison-section";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

vi.mock("react-chartjs-2", () => ({
  Line: () => <div data-testid="chart" />,
}));

function mkPlan(opts: {
  label: string;
  gifts: Array<{ year: number; amount: number; recipient?: string }>;
  beneficiaries: Array<{ id: string; kind: "charity" | "individual" }>;
  years: Array<{
    year: number;
    charitableOutflows: number;
    charityCarryforward?: {
      cashPublic: { amount: number; originYear: number }[];
      cashPrivate: { amount: number; originYear: number }[];
      appreciatedPublic: { amount: number; originYear: number }[];
      appreciatedPrivate: { amount: number; originYear: number }[];
    };
  }>;
}): ComparisonPlan {
  return {
    index: 0,
    isBaseline: true,
    ref: { kind: "scenario", id: opts.label },
    id: opts.label,
    label: opts.label,
    tree: {
      gifts: opts.gifts.map((g, i) => ({
        id: `g${i}`,
        year: g.year,
        amount: g.amount,
        grantor: "client",
        recipientExternalBeneficiaryId: g.recipient,
        useCrummeyPowers: false,
      })),
      externalBeneficiaries: opts.beneficiaries.map((b) => ({
        id: b.id,
        name: b.id,
        kind: b.kind,
        charityType: "public" as const,
      })),
    } as ComparisonPlan["tree"],
    result: {
      years: opts.years as ComparisonPlan["result"]["years"],
    } as ComparisonPlan["result"],
    lifetime: {} as ComparisonPlan["lifetime"],
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
  };
}

describe("CharitableImpactComparisonSection", () => {
  it("renders a single overlay chart and one stat tile per plan", () => {
    render(
      <CharitableImpactComparisonSection
        plans={[
          mkPlan({
            label: "A",
            gifts: [{ year: 2030, amount: 5000, recipient: "ch1" }],
            beneficiaries: [{ id: "ch1", kind: "charity" }],
            years: [{ year: 2030, charitableOutflows: 1000 }],
          }),
          mkPlan({
            label: "B",
            gifts: [],
            beneficiaries: [],
            years: [{ year: 2030, charitableOutflows: 2000 }],
          }),
        ]}
        yearRange={null}
      />,
    );
    expect(screen.getAllByTestId("chart")).toHaveLength(1);
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText("B")).toBeTruthy();
    expect(screen.getByText("$6,000")).toBeTruthy(); // A: 5000 gift + 1000 CLUT
    expect(screen.getByText("$2,000")).toBeTruthy(); // B: 0 gift + 2000 CLUT
  });

  it("renders an empty state when no plan has any charitable outflow in range", () => {
    render(
      <CharitableImpactComparisonSection
        plans={[
          mkPlan({
            label: "A",
            gifts: [],
            beneficiaries: [],
            years: [{ year: 2030, charitableOutflows: 0 }],
          }),
        ]}
        yearRange={null}
      />,
    );
    expect(screen.getByText(/No charitable outflows/i)).toBeTruthy();
  });

  it("renders remaining-carryforward in the stat row using the last clipped year", () => {
    render(
      <CharitableImpactComparisonSection
        plans={[
          mkPlan({
            label: "A",
            gifts: [{ year: 2030, amount: 1000, recipient: "ch1" }],
            beneficiaries: [{ id: "ch1", kind: "charity" }],
            years: [
              {
                year: 2030,
                charitableOutflows: 0,
                charityCarryforward: {
                  cashPublic: [{ amount: 500, originYear: 2030 }],
                  cashPrivate: [],
                  appreciatedPublic: [],
                  appreciatedPrivate: [],
                },
              },
            ],
          }),
        ]}
        yearRange={null}
      />,
    );
    expect(screen.getByText(/Carryforward: \$500/i)).toBeTruthy();
  });
});
