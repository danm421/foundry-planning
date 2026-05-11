// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { LifetimeTaxComparisonChart } from "../lifetime-tax-comparison-chart";

vi.mock("react-chartjs-2", () => ({ Bar: vi.fn(() => null) }));
import { Bar } from "react-chartjs-2";

const bucket = (over: Partial<Record<string, number>> = {}) => ({
  regularFederalIncomeTax: over.regularFederalIncomeTax ?? 0,
  capitalGainsTax: over.capitalGainsTax ?? 0,
  amtAdditional: 0,
  niit: 0,
  additionalMedicare: 0,
  fica: 0,
  stateTax: 0,
});

describe("LifetimeTaxComparisonChart (N series)", () => {
  it("renders N datasets at N=4", () => {
    render(
      <LifetimeTaxComparisonChart
        plans={[
          { label: "Base", buckets: bucket({ regularFederalIncomeTax: 100 }) },
          { label: "A",    buckets: bucket({ regularFederalIncomeTax: 80 }) },
          { label: "B",    buckets: bucket({ regularFederalIncomeTax: 60 }) },
          { label: "C",    buckets: bucket({ regularFederalIncomeTax: 40 }) },
        ]}
      />,
    );
    const props = vi.mocked(Bar).mock.calls.at(-1)![0] as { data: { datasets: unknown[] } };
    expect(props.data.datasets).toHaveLength(4);
  });

  it("uses palette colors per index", () => {
    render(
      <LifetimeTaxComparisonChart
        plans={[
          { label: "Base", buckets: bucket({ capitalGainsTax: 50 }) },
          { label: "X",    buckets: bucket({ capitalGainsTax: 70 }) },
        ]}
      />,
    );
    const props = vi.mocked(Bar).mock.calls.at(-1)![0] as {
      data: { datasets: { backgroundColor: string }[] };
    };
    expect(props.data.datasets[0].backgroundColor).toBe("#cbd5e1");
    expect(props.data.datasets[1].backgroundColor).toBe("#34d399");
  });
});
