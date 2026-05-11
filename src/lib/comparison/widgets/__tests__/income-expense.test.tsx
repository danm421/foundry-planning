// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { incomeExpenseWidget } from "../income-expense";
import type { ComparisonPlan } from "../../build-comparison-plans";

// Avoid pulling in Chart.js when only checking widget metadata.
vi.mock("@/components/comparison/income-expense-comparison-section", () => ({
  IncomeExpenseComparisonSection: () => <div data-test="rendered" />,
}));

const baseCtx = {
  instanceId: "11111111-1111-4111-8111-111111111111",
  clientId: "c",
  plans: [] as ComparisonPlan[],
  mc: null,
  config: undefined,
  yearRange: null,
  editing: false,
};

describe("incomeExpenseWidget", () => {
  it("has the expected metadata", () => {
    expect(incomeExpenseWidget.kind).toBe("income-expense");
    expect(incomeExpenseWidget.title).toBe("Income & Expenses over time");
    expect(incomeExpenseWidget.needsMc).toBe(false);
  });

  it("renders the comparison section regardless of editing flag", () => {
    const { container } = render(
      <>{incomeExpenseWidget.render({ ...baseCtx, editing: true })}</>,
    );
    expect(container.querySelector("[data-test='rendered']")).toBeTruthy();
  });
});
