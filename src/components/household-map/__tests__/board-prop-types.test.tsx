// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import GoalsBoard from "../goals-board";
import CashFlowBoard from "../cash-flow-board";
import type { CashFlowBoardProps, GoalsBoardProps } from "@/lib/household-map/types";
import { TEST_SOLO_PEOPLE, TEST_INCOME_ITEM, TEST_PURCHASE_GOAL } from "./fixtures";

describe("board prop types", () => {
  it("renders GoalsBoard from the narrow prop set alone", () => {
    const props: GoalsBoardProps = {
      people: TEST_SOLO_PEOPLE,
      goals: [TEST_PURCHASE_GOAL],
      canEdit: false,
      expenseRows: {},
    };
    const { getByTestId } = render(<GoalsBoard {...props} />);
    expect(getByTestId("goal-row-expense:e1")).toBeTruthy();
  });

  it("renders CashFlowBoard from the narrow prop set alone", () => {
    const props: CashFlowBoardProps = {
      people: TEST_SOLO_PEOPLE,
      canEdit: false,
      items: [TEST_INCOME_ITEM],
    };
    const { getByTestId } = render(<CashFlowBoard {...props} />);
    expect(getByTestId("band-income-column-client").textContent).toContain("Salary");
  });
});
