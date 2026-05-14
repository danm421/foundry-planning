// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SaveAsScenarioDialog } from "../save-as-scenario-dialog";

const baseProps = {
  open: true,
  mutations: [
    { kind: "retirement-age", person: "client", age: 67 },
    { kind: "ss-claim-age", person: "client", age: 70 },
  ] as never,
  onClose: vi.fn(),
  onSubmit: vi.fn(),
};

beforeEach(() => {
  baseProps.onClose.mockReset();
  baseProps.onSubmit.mockReset();
});

describe("<SaveAsScenarioDialog />", () => {
  it("renders a human-readable line per mutation", () => {
    render(<SaveAsScenarioDialog {...baseProps} />);
    expect(screen.getByText(/Retirement age/i)).toBeInTheDocument();
    expect(screen.getByText(/SS claim age/i)).toBeInTheDocument();
  });

  it("disables Save when name is empty", () => {
    render(<SaveAsScenarioDialog {...baseProps} />);
    const save = screen.getByRole("button", { name: /save scenario/i });
    expect(save).toBeDisabled();
  });

  it("calls onSubmit with the entered name when Save is clicked", () => {
    render(<SaveAsScenarioDialog {...baseProps} />);
    fireEvent.change(screen.getByLabelText(/Name/i), {
      target: { value: "Retire at 67" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save scenario/i }));
    expect(baseProps.onSubmit).toHaveBeenCalledWith({ name: "Retire at 67" });
  });
});
