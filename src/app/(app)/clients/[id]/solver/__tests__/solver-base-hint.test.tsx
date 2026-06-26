// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SolverBaseHint } from "../solver-base-hint";

describe("SolverBaseHint", () => {
  it("renders nothing when base equals working", () => {
    const { container } = render(<SolverBaseHint base={65} working={65} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows 'base was X' when values differ", () => {
    render(<SolverBaseHint base={65} working={67} />);
    expect(screen.getByText(/base was/)).toBeTruthy();
    expect(screen.getByText("65")).toBeTruthy();
  });

  it("formats the base value when a formatter is supplied", () => {
    render(<SolverBaseHint base={1000} working={2000} format={(v) => `$${v}`} />);
    expect(screen.getByText("$1000")).toBeTruthy();
  });

  it("calls onReset when reset is clicked", () => {
    const onReset = vi.fn();
    render(<SolverBaseHint base={65} working={67} onReset={onReset} />);
    screen.getByRole("button", { name: "reset" }).click();
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("honors the explicit changed override (floats)", () => {
    const { container } = render(
      <SolverBaseHint base={1.0} working={1.0000001} changed={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
