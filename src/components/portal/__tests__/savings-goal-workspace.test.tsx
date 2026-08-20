// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SavingsGoalWorkspace } from "../savings-goal-workspace";
import { createDefaultSavingsGoalState } from "@/lib/calculators/savings-goal-state";
import type { SavingsGoalDTO } from "@/lib/portal/load-savings-goal";

vi.mock("../savings-goal-chart", () => ({
  SavingsGoalChart: () => <div data-testid="chart" />,
}));

const dto = (over: Partial<SavingsGoalDTO> = {}): SavingsGoalDTO => ({
  inflationRate: 0.03,
  state: createDefaultSavingsGoalState(),
  ...over,
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

describe("SavingsGoalWorkspace", () => {
  it("prompts rather than printing $0 when nothing is entered yet", () => {
    render(<SavingsGoalWorkspace dto={dto()} readOnly />);
    expect(screen.getByText(/tell us what it costs/i)).toBeTruthy();
  });

  it("answers with the monthly saving once a cost and a year are set", () => {
    const year = new Date().getFullYear() + 10;
    render(
      <SavingsGoalWorkspace
        dto={dto({ state: { ...createDefaultSavingsGoalState(), targetToday: 80_000, targetYear: year } })}
        readOnly
      />,
    );
    // The headline is a dollar figure per month, not a prompt.
    expect(screen.getByTestId("savings-goal-answer").textContent).toMatch(/^\$[\d,]+$/);
  });

  it("says they're already there instead of quoting a negative saving", () => {
    const year = new Date().getFullYear() + 10;
    render(
      <SavingsGoalWorkspace
        dto={dto({
          state: {
            ...createDefaultSavingsGoalState(),
            targetToday: 10_000,
            currentSavings: 500_000,
            targetYear: year,
          },
        })}
        readOnly
      />,
    );
    expect(screen.getByText(/already there/i)).toBeTruthy();
  });

  it("treats a goal due this year as a lump sum, not a monthly figure", () => {
    render(
      <SavingsGoalWorkspace
        dto={dto({
          state: {
            ...createDefaultSavingsGoalState(),
            targetToday: 20_000,
            targetYear: new Date().getFullYear(),
          },
        })}
        readOnly
      />,
    );
    expect(screen.getByText(/lump sum/i)).toBeTruthy();
  });

  it("a preset chip fills BOTH the name and the year", () => {
    render(<SavingsGoalWorkspace dto={dto()} readOnly />);
    fireEvent.click(screen.getByRole("button", { name: "College" }));
    const name = screen.getByLabelText("Goal name") as HTMLInputElement;
    const year = screen.getByLabelText("Target year") as HTMLSelectElement;
    expect(name.value).toBe("College");
    expect(Number(year.value)).toBe(new Date().getFullYear() + 10);
  });

  it("never saves in readOnly mode", () => {
    render(<SavingsGoalWorkspace dto={dto()} readOnly />);
    fireEvent.click(screen.getByRole("button", { name: "Car" }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows the validator's own reason when the name is cleared", () => {
    render(<SavingsGoalWorkspace dto={dto()} readOnly />);
    fireEvent.change(screen.getByLabelText("Goal name"), { target: { value: "" } });
    expect(screen.getByText(/give your goal a name/i)).toBeTruthy();
  });
});
