// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { incomeExpenseWidget } from "../income-expense";
import { IDLE_MC_RUN } from "../types";
import type { ComparisonPlan } from "../../build-comparison-plans";

vi.mock("@/components/comparison/income-expense-comparison-section", () => ({
  IncomeExpenseComparisonSection: () => <div data-test="rendered" />,
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

function makePlanFixture(): ComparisonPlan {
  return {
    index: 0,
    isBaseline: true,
    ref: { kind: "scenario", id: "base" } as never,
    id: "base",
    label: "Base",
    tree: {} as never,
    result: {
      years: [
        {
          year: 2026,
          income: {
            salaries: 100,
            socialSecurity: 0,
            business: 0,
            trust: 0,
            deferred: 0,
            capitalGains: 0,
            other: 0,
          },
          expenses: {
            living: 50,
            realEstate: 0,
            insurance: 0,
            taxes: 10,
            liabilities: 0,
            other: 0,
          },
        },
      ],
    } as never,
    lifetime: { total: 0, perYear: [] } as never,
    liquidityRows: [] as never,
    finalEstate: null,
    panelData: null,
  };
}

describe("incomeExpenseWidget", () => {
  it("has the expected metadata", () => {
    expect(incomeExpenseWidget.kind).toBe("income-expense");
    expect(incomeExpenseWidget.title).toBe("Cash Flow Bar Chart");
    expect(incomeExpenseWidget.needsMc).toBe(false);
  });

  it("renders the comparison section regardless of editing flag", () => {
    const { container } = render(
      <>{incomeExpenseWidget.render({ ...baseCtx, editing: true })}</>,
    );
    expect(container.querySelector("[data-test='rendered']")).toBeTruthy();
  });

  it("renders the table when config.viewMode = 'table'", () => {
    render(
      <>
        {incomeExpenseWidget.render({
          ...baseCtx,
          plans: [makePlanFixture()],
          config: { viewMode: "table" },
        })}
      </>,
    );
    expect(document.querySelector("[data-test='rendered']")).toBeNull();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("renders the chart when config.viewMode = 'chart'", () => {
    render(
      <>
        {incomeExpenseWidget.render({
          ...baseCtx,
          plans: [makePlanFixture()],
          config: { viewMode: "chart" },
        })}
      </>,
    );
    expect(document.querySelector("[data-test='rendered']")).not.toBeNull();
  });
});
