// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SolverPosGauge } from "../solver-pos-gauge";

describe("SolverPosGauge — overlay", () => {
  it("shows no overlay button when ready", () => {
    render(
      <SolverPosGauge state="ready" successPct={0.88} onRegenerate={vi.fn()} />,
    );
    expect(screen.getByText("88%")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /recalculate/i })).toBeNull();
  });

  it("shows no overlay when stale — the run fires automatically", () => {
    const { container } = render(
      <SolverPosGauge state="stale" successPct={0.88} onRegenerate={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /recalculate/i })).toBeNull();
    // The prior value stays on screen, dimmed, through the auto-run debounce.
    expect(screen.getByText("88%")).toBeTruthy();
    expect(container.querySelector(".opacity-40")).toBeTruthy();
  });

  it("shows the overlay button on error (acts as retry) and calls onRegenerate", () => {
    const onRegenerate = vi.fn();
    render(
      <SolverPosGauge state="error" successPct={null} onRegenerate={onRegenerate} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /recalculate/i }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("disables the overlay button while a solve is active", () => {
    render(
      <SolverPosGauge
        state="error"
        successPct={null}
        onRegenerate={vi.fn()}
        solveActive
      />,
    );
    expect(screen.getByRole("button", { name: /recalculate/i })).toBeDisabled();
  });

  it("never shows an overlay without an onRegenerate handler (base column)", () => {
    render(<SolverPosGauge state="error" successPct={null} />);
    expect(screen.queryByRole("button", { name: /recalculate/i })).toBeNull();
  });
});

describe("SolverPosGauge — computing state", () => {
  it("renders the branded fan mark instead of a value", () => {
    const { container } = render(
      <SolverPosGauge state="computing" successPct={null} onRegenerate={vi.fn()} />,
    );
    expect(container.querySelectorAll("svg .mark-draw")).toHaveLength(5);
  });

  it("announces the run to screen readers", () => {
    render(
      <SolverPosGauge state="computing" successPct={null} onRegenerate={vi.fn()} />,
    );
    expect(
      screen.getByRole("status", { name: /calculating probability of success/i }),
    ).toBeTruthy();
  });
});
