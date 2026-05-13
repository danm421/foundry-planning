// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { withdrawalSourceWidget } from "../withdrawal-source";
import { IDLE_MC_RUN } from "../types";
import type { ComparisonPlan } from "../../build-comparison-plans";

vi.mock("@/components/comparison/withdrawal-source-comparison-section", () => ({
  WithdrawalSourceComparisonSection: () => <div data-test="rendered" />,
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

describe("withdrawalSourceWidget", () => {
  it("has the expected metadata", () => {
    expect(withdrawalSourceWidget.kind).toBe("withdrawal-source");
    expect(withdrawalSourceWidget.title).toBe("Withdrawal Source");
    expect(withdrawalSourceWidget.needsMc).toBe(false);
  });

  it("renders the comparison section regardless of editing flag", () => {
    const { container } = render(
      <>{withdrawalSourceWidget.render({ ...baseCtx, editing: true })}</>,
    );
    expect(container.querySelector("[data-test='rendered']")).toBeTruthy();
  });
});
