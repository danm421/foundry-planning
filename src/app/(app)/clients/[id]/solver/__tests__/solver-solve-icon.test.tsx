// @vitest-environment jsdom
/**
 * Intent test: the per-lever solve trigger must expose a VISIBLE "Solve" text
 * label (not just an aria-label or title attribute). This ensures the affordance
 * is discoverable without assistive technology.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SolverSolveIcon } from "../solver-solve-icon";

describe("SolverSolveIcon — labeled button affordance", () => {
  it("renders visible 'Solve' text (not just aria-label)", () => {
    render(
      <SolverSolveIcon label="Solve Retirement Age" disabled={false} onClick={vi.fn()} />,
    );
    // The button must contain a visible text node matching /solve/i — not just
    // an aria-label. getByText only matches visible, non-aria-hidden content.
    expect(screen.getByText(/solve/i)).toBeTruthy();
  });

  it("is a button with accessible name matching /solve/i", () => {
    render(
      <SolverSolveIcon label="Solve Something" disabled={false} onClick={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /solve/i })).toBeTruthy();
  });

  it("fires onClick when clicked and is disabled when disabled=true", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <SolverSolveIcon label="Solve Something" disabled={false} onClick={onClick} />,
    );
    screen.getByRole("button", { name: /solve/i }).click();
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <SolverSolveIcon label="Solve Something" disabled={true} onClick={onClick} />,
    );
    expect(screen.getByRole("button", { name: /solve/i })).toBeDisabled();
  });
});
