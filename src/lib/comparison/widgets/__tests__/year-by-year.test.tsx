// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { yearByYearWidget } from "../year-by-year";
import { IDLE_MC_RUN } from "../types";
import type { ComparisonPlan } from "../../build-comparison-plans";

vi.mock("@/components/comparison/year-by-year-comparison-section", () => ({
  YearByYearComparisonSection: () => <div data-test="rendered" />,
}));

const baseCtx = {
  instanceId: "11111111-1111-4111-8111-111111111111",
  clientId: "c",
  plans: [] as ComparisonPlan[],
  mc: null,
  mcRun: IDLE_MC_RUN,
  config: undefined,
  yearRange: null,
  editing: false,
};

describe("yearByYearWidget", () => {
  it("has the expected metadata", () => {
    expect(yearByYearWidget.kind).toBe("year-by-year");
    expect(yearByYearWidget.title).toBe("Year-by-year detail");
    expect(yearByYearWidget.needsMc).toBe(false);
  });

  it("renders the comparison section regardless of editing flag", () => {
    const { container } = render(
      <>{yearByYearWidget.render({ ...baseCtx, editing: true })}</>,
    );
    expect(container.querySelector("[data-test='rendered']")).toBeTruthy();
  });
});
