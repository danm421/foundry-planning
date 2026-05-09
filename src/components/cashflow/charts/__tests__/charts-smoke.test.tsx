// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { IncomeChart } from "../income-chart";
import { ExpensesChart } from "../expenses-chart";
import { SavingsChart } from "../savings-chart";
import { WithdrawalsChart } from "../withdrawals-chart";
import { PortfolioChart } from "../portfolio-chart";
import { TaxIncomeChart } from "../tax-income-chart";
import { TaxFederalChart } from "../tax-federal-chart";
import { TaxBracketChart } from "../tax-bracket-chart";
import { incomeFixture } from "./fixtures";

describe("chart smoke tests", () => {
  it.each([
    ["IncomeChart", () => <IncomeChart years={incomeFixture} dataVersion="test" />],
    ["ExpensesChart", () => <ExpensesChart years={incomeFixture} dataVersion="test" />],
    [
      "SavingsChart",
      () => {
        const yearsWithSavings = incomeFixture.map((y) => ({
          ...y,
          savings: { byAccount: { a1: 1000 }, total: 1000, employerTotal: 0 },
        }));
        return <SavingsChart years={yearsWithSavings} accountSubTypes={{ a1: "401k" }} />;
      },
    ],
    [
      "WithdrawalsChart",
      () => {
        const yearsWithWithdrawals = incomeFixture.map((y) => ({
          ...y,
          withdrawals: { byAccount: { a1: 1000 }, total: 1000 },
        }));
        return <WithdrawalsChart years={yearsWithWithdrawals} accountCategoryById={{ a1: "retirement" }} dataVersion="test" />;
      },
    ],
    ["PortfolioChart", () => <PortfolioChart years={incomeFixture} dataVersion="test" />],
    ["TaxIncomeChart", () => <TaxIncomeChart years={incomeFixture} />],
    ["TaxFederalChart", () => <TaxFederalChart years={incomeFixture} />],
    ["TaxBracketChart", () => <TaxBracketChart years={incomeFixture} />],
  ])("%s renders without throwing", (_name, Renderer) => {
    const { container } = render(<Renderer />);
    expect(container.querySelector("canvas")).not.toBeNull();
  });
});
