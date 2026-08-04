// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import GoalsBoard from "../goals-board";
import CashFlowBoard from "../cash-flow-board";
import type { CashFlowBoardProps, GoalsBoardProps, MapPerson } from "@/lib/household-map/types";

const CLIENT: MapPerson = {
  familyMemberId: "fm-1",
  firstName: "Cooper",
  age: 50,
  retirementYear: 2040,
  birthYear: 1976,
};

describe("board prop types", () => {
  it("renders GoalsBoard from the narrow prop set alone", () => {
    const props: GoalsBoardProps = {
      people: { client: CLIENT, spouse: null, children: [] },
      goals: [
        {
          id: "expense:e1",
          year: 2030,
          kind: "purchase",
          side: "joint",
          title: "New roof",
          detail: "$40,000",
          expenseId: "e1",
          forFamilyMemberName: null,
          lifeExpectancy: null,
        },
      ],
      canEdit: false,
      expenseRows: {},
    };
    const { getByTestId } = render(<GoalsBoard {...props} />);
    expect(getByTestId("goal-row-expense:e1")).toBeTruthy();
  });

  it("renders CashFlowBoard from the narrow prop set alone", () => {
    const props: CashFlowBoardProps = {
      people: { client: CLIENT, spouse: null, children: [] },
      canEdit: false,
      items: [
        {
          id: "i1",
          kind: "income",
          category: "investments",
          name: "Salary",
          valueLabel: "$200,000",
          value: 200000,
          column: "client",
          splitChip: null,
          trayOwnerLabel: null,
          noteChip: null,
          timing: null,
          editableAmount: 200000,
        },
      ],
    };
    const { getByTestId } = render(<CashFlowBoard {...props} />);
    expect(getByTestId("band-income-column-client").textContent).toContain("Salary");
  });
});
