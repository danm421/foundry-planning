// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StackedBarChart } from "../stacked-bar-chart";
import { incomeFixture } from "./fixtures";

describe("StackedBarChart", () => {
  it("renders a canvas with the given series without throwing", () => {
    const { container } = render(
      <StackedBarChart
        years={incomeFixture}
        series={[
          { label: "Salaries", colorKey: "green", valueFor: (y) => y.income.salaries },
          { label: "Social Security", colorKey: "blue", valueFor: (y) => y.income.socialSecurity },
        ]}
        title="Test"
      />,
    );
    expect(container.querySelector("canvas")).not.toBeNull();
  });

  it("renders nothing when years is empty", () => {
    const { container } = render(
      <StackedBarChart years={[]} series={[]} />,
    );
    expect(container.querySelector("canvas")).toBeNull();
  });
});
