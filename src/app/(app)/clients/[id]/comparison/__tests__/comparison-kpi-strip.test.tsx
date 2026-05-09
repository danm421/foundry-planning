// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ComparisonKpiStrip } from "../comparison-kpi-strip";

describe("ComparisonKpiStrip", () => {
  it("renders six tiles with deltas", () => {
    const { container } = render(
      <ComparisonKpiStrip
        endingNetWorthDelta={2400000}
        mcSuccessDelta={0.12}
        lifetimeTaxDelta={-340000}
        toHeirsDelta={1800000}
        estateTaxDelta={-520000}
        yearsSurvivesDelta={5}
      />,
    );
    expect(container.textContent).toContain("Ending NW");
    expect(container.textContent).toContain("MC Success");
    expect(container.textContent).toContain("Lifetime Tax");
    expect(container.textContent).toContain("To Heirs");
    expect(container.textContent).toContain("Estate Tax");
    expect(container.textContent).toContain("Years Survives");
    expect(container.textContent).toContain("+$2,400,000");
    expect(container.textContent).toContain("+12 pts");
    expect(container.textContent).toContain("−$340,000");
  });

  it("shows '…' for the MC tile when delta is undefined", () => {
    const { container } = render(
      <ComparisonKpiStrip
        endingNetWorthDelta={0}
        mcSuccessDelta={undefined}
        lifetimeTaxDelta={0}
        toHeirsDelta={0}
        estateTaxDelta={0}
        yearsSurvivesDelta={0}
      />,
    );
    expect(container.textContent).toContain("…");
  });
});
