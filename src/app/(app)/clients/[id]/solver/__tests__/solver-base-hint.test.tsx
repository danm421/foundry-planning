// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SolverBaseHint } from "../solver-base-hint";

describe("SolverBaseHint", () => {
  it("renders nothing when base equals working", () => {
    const { container } = render(<SolverBaseHint base={65} working={65} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a passive 'base was X' note when values differ and no reset handler", () => {
    render(<SolverBaseHint base={65} working={67} />);
    expect(screen.getByText(/base was/)).toBeTruthy();
    expect(screen.getByText("65")).toBeTruthy();
  });

  it("formats the base value when a formatter is supplied", () => {
    render(<SolverBaseHint base={1000} working={2000} format={(v) => `$${v}`} />);
    expect(screen.getByText("$1000")).toBeTruthy();
  });

  it("shows a 'Reset to <base>' action carrying the prior value", () => {
    const onReset = vi.fn();
    render(
      <SolverBaseHint base={210000} working={185000} format={(v) => `$${v}/yr`} onReset={onReset} />,
    );
    const btn = screen.getByRole("button", { name: /Reset to/ });
    expect(btn.textContent).toContain("$210000/yr");
    btn.click();
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("honors the explicit changed override (floats)", () => {
    const { container } = render(
      <SolverBaseHint base={1.0} working={1.0000001} changed={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
