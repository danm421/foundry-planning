// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
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

  // The three autosave tests below have to be read together. On its own the
  // read-only one cannot fail for the thing it names: an effect that never
  // saved at all would satisfy it just as well, which is what makes the
  // positive path its necessary partner.
  it("PUTs the validated setup once editing settles, after the debounce", async () => {
    vi.useFakeTimers();
    render(<SavingsGoalWorkspace dto={dto()} />);
    // Mounting alone must not write a row.
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Car" }));
    // Still inside the 700ms debounce window.
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/portal/calculators/savings-goal");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string) as { state: { name: string } };
    expect(body.state.name).toBe("Car");
  });

  it("never saves in readOnly mode, however long the debounce is given", async () => {
    vi.useFakeTimers();
    render(<SavingsGoalWorkspace dto={dto()} readOnly />);
    fireEvent.click(screen.getByRole("button", { name: "Car" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips the PUT and shows the validator's own reason when the name is cleared", async () => {
    vi.useFakeTimers();
    render(<SavingsGoalWorkspace dto={dto()} />);
    fireEvent.change(screen.getByLabelText("Goal name"), { target: { value: "" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/give your goal a name/i)).toBeTruthy();
  });
});
