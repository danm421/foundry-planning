// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { successGaugeWidget } from "../success-gauge";
import { IDLE_MC_RUN } from "../types";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

const plan = { id: "base", label: "Base" } as ComparisonPlan;

describe("successGaugeWidget", () => {
  it("renders the gauge with the plan's success probability when MC is loaded", () => {
    render(
      <>
        {successGaugeWidget.render({
          instanceId: "1",
          clientId: "c",
          plans: [plan],
          mc: {
            perPlan: [],
            threshold: 0.85,
            successByIndex: { 0: 0.82 },
            planStartYear: 2026,
            clientBirthYear: 1965,
          },
          mcRun: IDLE_MC_RUN,
          yearRange: null,
          editing: false,
        })}
      </>,
    );
    expect(screen.getByTestId("gauge-label")).toHaveTextContent("82%");
    expect(screen.getByText(/base/i)).toBeInTheDocument();
  });

  it("renders a loading skeleton when MC is null", () => {
    const { container } = render(
      <>
        {successGaugeWidget.render({
          instanceId: "1",
          clientId: "c",
          plans: [plan],
          mc: null,
          mcRun: IDLE_MC_RUN,
          yearRange: null,
          editing: false,
        })}
      </>,
    );
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("declares scenarios=one, needsMc=true, kind=success-gauge", () => {
    expect(successGaugeWidget.kind).toBe("success-gauge");
    expect(successGaugeWidget.scenarios).toBe("one");
    expect(successGaugeWidget.needsMc).toBe(true);
  });
});
